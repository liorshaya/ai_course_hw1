require("dotenv").config();

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const OpenAI = require("openai");
const {
  getWeather,
  calculateMath,
  getExchangeRate,
  generalChat
} = require("./tools");

const HISTORY_PATH = path.join(__dirname, "history.json");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let history = [];

function saveHistory() {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    history = [];
    return;
  }

  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    history = Array.isArray(parsed) ? parsed : [];
    console.log("ברוך שובך");
  } catch (_error) {
    history = [];
    saveHistory();
  }
}

function resetHistory() {
  history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    fs.unlinkSync(HISTORY_PATH);
  }
  console.log("History reset.");
}

function buildRouterMessages(context, originalUserInput, requireFinal) {
  const lastTurn =
    context.length > 0 ? context[context.length - 1] : null;
  const lastWasTool = lastTurn && lastTurn.role === "tool";

  return [
    {
      role: "system",
      content: [
        "You are the planner/router for a CLI AI assistant.",
        'Always return ONLY valid JSON with the exact keys "action", "tool", "params", and "finalResponse".',
        'Schema: {"action":"tool|final","tool":"calculateMath|getWeather|getExchangeRate|generalChat","params":{...},"finalResponse":"string when action is final"}',
        'Tool param schemas (MUST match exactly):',
        '- calculateMath: {"action":"tool","tool":"calculateMath","params":{"expression":"string"}}',
        '- getWeather: {"action":"tool","tool":"getWeather","params":{"city":"string"}}',
        '- getExchangeRate: {"action":"tool","tool":"getExchangeRate","params":{"fromCurrency":"USD","toCurrency":"ILS","amount":100}}',
        '- generalChat: {"action":"tool","tool":"generalChat","params":{}}',
        'The field MUST be named "action" (lowercase). Use "final" not "answer" for a user-ready reply.',
        lastWasTool
          ? 'CRITICAL: The last entry in history is a tool result. Your next output MUST be {"action":"final",...} with a complete "finalResponse" in fluent Hebrew for the user. Do NOT use {"action":"tool"} unless you still lack an essential fact (e.g. a second city for weather comparison).'
          : "",
        "If the last message in history is a 'tool' result, your next action MUST be to provide a final answer to the user in Hebrew. Use action: \"final\" with your response in finalResponse.",
        "Flow:",
        "- If no tool result is present yet and you need data, set action to \"tool\" and set tool + params.",
        "- After ANY TOOL_RESULT appears in history, the ONLY valid next step is action \"final\" with finalResponse in Hebrew.",
        "If the last message in history is a 'tool' result, your ONLY valid next step is to provide a 'final' response summarizing that data in Hebrew.",
        requireFinal
          ? "MANDATORY NOW: A tool has already run. Return ONLY action=\"final\" with finalResponse in Hebrew."
          : "",
        "When you see a calculateMath result in history, your next step is to provide the final result in a friendly Hebrew sentence (example: \"התוצאה היא 170\") using action=\"final\".",
        "When finalResponse includes comparison or calculation (like weather differences or currency conversion), use the exact numeric values from TOOL_RESULT in history. Do not estimate or hallucinate.",
        `Original user question (must stay in scope): ${String(originalUserInput || "").trim()}`,
        "- Only exception: the user clearly needs two independent facts (e.g. weather in two cities): then at most one more action \"tool\", then mandatory action \"final\".",
        '- For simple math: one calculateMath, then {"action":"final",...} with numbers from the tool.',
        '- For getExchangeRate: after success, finalResponse MUST include a specific numeric rate and pair in Hebrew (example: "שער הדולר היום הוא 3.15 שקלים").',
        '- If getExchangeRate fails due to bad params, immediately retry with corrected params using fromCurrency/toCurrency (not generic failure text).',
        '- If user asks "How much is a dollar in shekels?" and params are missing, use fromCurrency="USD", toCurrency="ILS".',
        "- Never output markdown, code fences, or text outside the JSON object."
      ]
        .filter(Boolean)
        .join("\n")
    },
    ...context.map((item) => {
      if (item.role === "tool") {
        return {
          role: "assistant",
          content: `TOOL_RESULT(${item.name || "unknown"}): ${item.content}`
        };
      }
      return {
        role: item.role,
        content: item.content
      };
    })
  ];
}

function getLastUserMessage() {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "user") {
      return String(history[i].content || "");
    }
  }
  return "";
}

function ensureNonEmptyString(value) {
  const t = String(value ?? "").trim();
  return t.length > 0 ? t : "לא התקבלה תשובה מהמודל. נסה שוב.";
}

/**
 * Appends the assistant turn to history, persists, and returns the exact same
 * string written to history.json (single source of truth for terminal output).
 */
function finalizeAssistantReply(draftContent) {
  const content = ensureNonEmptyString(draftContent);
  history.push({
    role: "assistant",
    content,
    timestamp: new Date().toISOString()
  });
  saveHistory();
  return String(history[history.length - 1].content);
}

function getLastAssistantContent() {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "assistant") {
      return String(history[i].content ?? "");
    }
  }
  return "";
}

function tryParseToolPayload(entry) {
  if (!entry || entry.role !== "tool") {
    return null;
  }
  try {
    return JSON.parse(entry.content);
  } catch {
    return null;
  }
}

function lastHistoryEntry() {
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * When the router loop exhausts without action "final", produce a Hebrew line from the last tool or assistant row (no extra LLM if data is clear).
 */
function summarizeLastToolOrAssistantForTerminal() {
  const fromAssistant = getLastAssistantContent().trim();
  if (fromAssistant) {
    return fromAssistant;
  }

  const last = lastHistoryEntry();
  const payload = tryParseToolPayload(last);
  const r = payload?.result;

  if (!r) {
    return "נאספו נתונים אך לא נוצרה תשובה סופית. נסה שוב או נסח את הבקשה מחדש.";
  }

  if (r.ok && r.tool === "getExchangeRate") {
    const amt =
      typeof r.convertedAmount === "number" && Number.isFinite(r.convertedAmount)
        ? ` — כלומר בערך ${r.convertedAmount} ${r.targetCurrency}`
        : "";
    return `לפי השער העדכני, 1 ${r.baseCurrency} שווה בערך ${r.rate} ${r.targetCurrency}${amt} (נכון לתאריך ${r.date || "?"}).`;
  }

  if (r.ok && r.tool === "calculateMath") {
    return `התוצאה של ${r.expression} היא ${r.result}.`;
  }

  if (r.ok && r.tool === "getWeather") {
    return `ב-${r.city}: כ-${r.temperatureC}°C, ${r.description || ""}.`;
  }

  if (r.error) {
    return `אירעה בעיה: ${r.error}`;
  }

  return "יש תוצאת כלי אך לא ניתן לנסח סיכום קצר. נסה שוב.";
}

function normalizeRouterPlanJson(plan) {
  if (!plan || typeof plan !== "object") {
    return {
      action: "tool",
      tool: "generalChat",
      params: {},
      finalResponse: ""
    };
  }

  let params = plan.params ?? plan.parameters ?? plan.args ?? {};
  if (!params || typeof params !== "object") {
    params = {};
  }

  let finalResponse =
    plan.finalResponse ??
    plan.final_response ??
    plan.message ??
    plan.text ??
    plan.reply ??
    "";
  finalResponse = String(finalResponse ?? "").trim();

  const hadExplicitAction =
    plan.action !== undefined ||
    plan.Action !== undefined ||
    plan.next_action !== undefined ||
    plan.decision !== undefined;

  let action = plan.action ?? plan.Action ?? plan.next_action ?? plan.decision;
  action = String(action ?? "").trim().toLowerCase();

  if (!hadExplicitAction && finalResponse.length > 0) {
    action = "final";
  } else if (!action) {
    action = "tool";
  }

  if (action === "answer" || action === "complete" || action === "done") {
    action = "final";
  }
  if (
    action === "call_tool" ||
    action === "tool_call" ||
    action === "use_tool"
  ) {
    action = "tool";
  }

  let tool = plan.tool ?? plan.Tool ?? plan.toolName ?? "generalChat";
  tool = String(tool ?? "generalChat").trim();

  return {
    action,
    tool,
    params,
    finalResponse
  };
}

/**
 * After getExchangeRate succeeds, the router should return action final. If it schedules another tool unnecessarily, synthesize instead.
 */
function shouldSynthesizeInsteadOfSecondTool(plan) {
  const last = lastHistoryEntry();
  const payload = tryParseToolPayload(last);
  const r = payload?.result;
  if (!payload || !r?.ok || payload.tool !== "getExchangeRate") {
    return false;
  }
  if (String(plan.action || "").toLowerCase() !== "tool") {
    return false;
  }
  if (plan.tool === "generalChat") {
    return true;
  }
  if (plan.tool === "getExchangeRate") {
    try {
      const a = JSON.stringify(payload.params || {});
      const b = JSON.stringify(plan.params || {});
      return a === b;
    } catch {
      return false;
    }
  }
  return false;
}

async function synthesizeHebrewFinalResponse() {
  if (!process.env.OPENAI_API_KEY) {
    return "לא ניתן לייצר תשובה סופית כרגע.";
  }

  const context = history.slice(-24).map((item) => {
    if (item.role === "tool") {
      return {
        role: "user",
        content: `תוצאת כלי (${item.name || "?"}): ${item.content}`
      };
    }
    return {
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "")
    };
  });

  const completion = await openai.chat.completions.create({
    model: process.env.CHAT_MODEL || process.env.ROUTER_MODEL || "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You write the final reply to the user. Output fluent Hebrew only. Be concise and helpful. " +
          "Use tool results above when present. For math, state the numeric result clearly (e.g. התוצאה של ... היא ...)."
      },
      ...context,
      {
        role: "user",
        content: `השאלה המקורית של המשתמש: ${getLastUserMessage() || "(לא זמין)"}`
      }
    ]
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  return text || "לא הצלחתי לנסח תשובה בעברית.";
}

async function getRouterPlan(
  originalUserInput,
  requireFinal = false,
  currentHistory = history
) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      action: "final",
      tool: "generalChat",
      params: {},
      finalResponse: "חסר מפתח OPENAI_API_KEY ולכן לא ניתן להשלים את הבקשה כרגע."
    };
  }

  const context = currentHistory.map((item) => ({
    role: item.role,
    content: item.content,
    name: item.name
  }));

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.ROUTER_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: buildRouterMessages(context, originalUserInput, requireFinal)
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const normalized = normalizeRouterPlanJson(parsed);
    const action = normalized.action;
    let tool = normalized.tool;
    const params = normalized.params;
    let finalResponse = normalized.finalResponse;
    const supportedTools = new Set([
      "calculateMath",
      "getWeather",
      "getExchangeRate",
      "generalChat"
    ]);

    if (action === "final") {
      if (!finalResponse) {
        finalResponse = await synthesizeHebrewFinalResponse();
      }
      return { action: "final", tool, params, finalResponse };
    }

    if (requireFinal) {
      finalResponse = await synthesizeHebrewFinalResponse();
      return { action: "final", tool: "generalChat", params: {}, finalResponse };
    }

    tool = supportedTools.has(tool) ? tool : "generalChat";
    return { action: "tool", tool, params, finalResponse: "" };
  } catch (_error) {
    if (requireFinal) {
      const finalResponse = await synthesizeHebrewFinalResponse();
      return { action: "final", tool: "generalChat", params: {}, finalResponse };
    }
    return { action: "tool", tool: "generalChat", params: {}, finalResponse: "" };
  }
}

async function executeTool(plan, userInput) {
  switch (plan.tool) {
    case "calculateMath":
      return calculateMath(plan.params.expression || userInput);
    case "getWeather":
      return getWeather(plan.params.city || "");
    case "getExchangeRate":
      return getExchangeRate(plan.params);
    case "generalChat":
      return generalChat(
        history.slice(-20).map((item) => ({
          role: item.role,
          content: item.content
        })),
        userInput
      );
    default:
      return generalChat(
        history.slice(-20).map((item) => ({
          role: item.role,
          content: item.content
        })),
        userInput
      );
  }
}

function buildExchangeRepairParams(originalParams) {
  const p = originalParams && typeof originalParams === "object" ? originalParams : {};
  return {
    fromCurrency: p.fromCurrency || p.from || p.currencyCode || "USD",
    toCurrency: p.toCurrency || p.to || "ILS",
    amount: p.amount
  };
}

function hasAssistantAtHistoryEnd() {
  return history.length > 0 && history[history.length - 1].role === "assistant";
}

function finalizeAndAssert(draft) {
  const text = finalizeAssistantReply(draft);
  if (hasAssistantAtHistoryEnd()) {
    return text;
  }
  return finalizeAssistantReply("Thinking... " + summarizeLastToolOrAssistantForTerminal());
}

async function handleInput(userInput) {
  try {
    history.push({
      role: "user",
      content: userInput,
      timestamp: new Date().toISOString()
    });
    saveHistory();

    const maxSteps = 5;
    let steps = 0;
    let requireFinalNext = false;

    while (true) {
      if (steps >= maxSteps) {
        const forcedFinal = await generalChat(
          history.map((item) => ({
            role: item.role,
            content: String(item.content || "")
          })),
          "Summarize the findings in the history for the user in Hebrew now."
        );
        const fallbackDraft = forcedFinal?.ok
          ? String(forcedFinal.answer || "").trim()
          : "Thinking... " + summarizeLastToolOrAssistantForTerminal();
        return finalizeAndAssert(fallbackDraft);
      }

      // CONTEXT SYNC: pass the latest updated history each iteration.
      const plan = await getRouterPlan(userInput, requireFinalNext, history);
      const action = String(plan.action || "")
        .trim()
        .toLowerCase();
      const isFinal = action === "final";
      const isGeneralChatPlan = plan.tool === "generalChat";

      // IF FINAL (or generalChat summary plan): return assistant message.
      if (isFinal) {
        let draft = String(plan.finalResponse ?? "").trim();
        if (!draft) {
          draft = await synthesizeHebrewFinalResponse();
        }
        return finalizeAndAssert(draft);
      }

      if (isGeneralChatPlan) {
        const chatResult = await executeTool(plan, userInput);
        const chatDraft = chatResult?.ok
          ? String(chatResult.answer || "").trim()
          : summarizeLastToolOrAssistantForTerminal();
        return finalizeAndAssert(chatDraft);
      }

      // IF TOOL: execute, save tool result, and continue loop (no return).
      const result = await executeTool(plan, userInput);
      let toolResult = result;

      if (!toolResult?.ok && plan.tool === "getExchangeRate") {
        const repairedParams = buildExchangeRepairParams(plan.params);
        const repairedResult = await getExchangeRate(repairedParams);
        if (repairedResult?.ok) {
          toolResult = {
            ...repairedResult,
            repairedFromError: true,
            repairParams: repairedParams
          };
        } else {
          toolResult = {
            ...toolResult,
            attemptedRepair: repairedParams,
            repairError: repairedResult?.error || null
          };
        }
      }

      history.push({
        role: "tool",
        name: plan.tool,
        content: JSON.stringify(
          {
            tool: plan.tool,
            params: plan.params,
            result: toolResult
          },
          null,
          2
        ),
        timestamp: new Date().toISOString()
      });
      saveHistory();

      requireFinalNext = true;
      steps += 1;
    }
  } catch (_error) {
    // Absolute safety net: never exit without writing assistant content.
    return finalizeAndAssert("Thinking... " + summarizeLastToolOrAssistantForTerminal());
  }
}

function bootstrap() {
  loadHistory();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> "
  });

  console.log("Agent started. Type /reset to clear history, /exit to quit.");
  rl.prompt();

  rl.on("line", async (line) => {
    const userInput = line.trim();

    if (userInput === "/reset") {
      resetHistory();
      rl.prompt();
      return;
    }

    if (userInput === "/exit") {
      rl.close();
      return;
    }

    if (!userInput) {
      rl.prompt();
      return;
    }

    try {
      const answer = await handleInput(userInput);
      const line =
        answer != null && String(answer).trim() !== ""
          ? String(answer)
          : ensureNonEmptyString(getLastAssistantContent());
      console.log(line);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("Goodbye.");
    process.exit(0);
  });
}

bootstrap();
