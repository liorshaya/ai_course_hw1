const OpenAI = require("openai");
const { evaluate } = require("mathjs");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function getWeather(city) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      tool: "getWeather",
      error: "Missing OPENWEATHER_API_KEY in .env."
    };
  }

  if (!city || !String(city).trim()) {
    return {
      ok: false,
      tool: "getWeather",
      error: "City is required."
    };
  }

  try {
    const encodedCity = encodeURIComponent(String(city).trim());
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodedCity}&limit=1&appid=${apiKey}`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) {
      throw new Error(`Geocoding API failed (${geoRes.status}).`);
    }

    const geoData = await geoRes.json();
    if (!Array.isArray(geoData) || geoData.length === 0) {
      return {
        ok: false,
        tool: "getWeather",
        city,
        error: "City not found."
      };
    }

    const location = geoData[0];
    const weatherUrl =
      `https://api.openweathermap.org/data/2.5/weather?lat=${location.lat}&lon=${location.lon}&appid=${apiKey}&units=metric`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) {
      throw new Error(`Weather API failed (${weatherRes.status}).`);
    }

    const weatherData = await weatherRes.json();
    return {
      ok: true,
      tool: "getWeather",
      city: `${location.name}${location.country ? `, ${location.country}` : ""}`,
      temperatureC: weatherData?.main?.temp,
      feelsLikeC: weatherData?.main?.feels_like,
      humidity: weatherData?.main?.humidity,
      description: weatherData?.weather?.[0]?.description || "No description",
      windSpeed: weatherData?.wind?.speed
    };
  } catch (error) {
    return {
      ok: false,
      tool: "getWeather",
      city,
      error: error.message
    };
  }
}

async function calculateMath(expression) {
  if (!expression || !String(expression).trim()) {
    return {
      ok: false,
      tool: "calculateMath",
      error: "Expression is required."
    };
  }

  try {
    const value = evaluate(String(expression));
    const result =
      typeof value === "number"
        ? Number.isFinite(value)
          ? value
          : String(value)
        : String(value);

    return {
      ok: true,
      tool: "calculateMath",
      expression,
      result
    };
  } catch (error) {
    return {
      ok: false,
      tool: "calculateMath",
      expression,
      error: `Invalid math expression: ${error.message}`
    };
  }
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseExchangeArgs(fromOrParams, toCurrency, amount) {
  let params = {};
  if (fromOrParams && typeof fromOrParams === "object") {
    params = fromOrParams;
  } else {
    params = {
      fromCurrency: fromOrParams,
      toCurrency,
      amount
    };
  }

  const fromRaw =
    params.fromCurrency ??
    params.from ??
    params.baseCurrency ??
    params.base ??
    params.currencyCode ??
    params.currency;
  const toRaw = params.toCurrency ?? params.to ?? params.targetCurrency ?? params.target;
  const amountRaw = params.amount ?? params.value;

  // Default for "dollar in shekels" style requests when router omits fields.
  const fromCode = String(fromRaw || "USD").trim().toUpperCase();
  const toCode = String(toRaw || "ILS").trim().toUpperCase();
  const amountNumber = toFiniteNumber(amountRaw);

  return {
    fromCode,
    toCode,
    amountNumber
  };
}

async function getExchangeRate(fromOrParams, toCurrency = "ILS", amount) {
  const { fromCode, toCode, amountNumber } = parseExchangeArgs(
    fromOrParams,
    toCurrency,
    amount
  );

  if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) {
    return {
      ok: false,
      tool: "getExchangeRate",
      errorCode: "INVALID_CURRENCY_CODE",
      fromCurrency: fromCode,
      toCurrency: toCode,
      error:
        "Exchange tool expects ISO currency codes. Router should pass fromCurrency/toCurrency as 3-letter codes (e.g., USD, EUR, ILS)."
    };
  }

  try {
    // Fetch base 1-unit rate and derive converted amount deterministically.
    const url = `https://api.frankfurter.app/latest?from=${fromCode}&to=${toCode}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Exchange API failed (${response.status}).`);
    }

    const data = await response.json();
    const rate = data?.rates?.[toCode];
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      return {
        ok: false,
        tool: "getExchangeRate",
        errorCode: "MISSING_RATE",
        fromCurrency: fromCode,
        toCurrency: toCode,
        error:
          "The exchange API did not return a valid rate for this pair. Router should try corrected fromCurrency/toCurrency values."
      };
    }

    const amountRequested = amountNumber ?? 1;
    return {
      ok: true,
      tool: "getExchangeRate",
      baseCurrency: fromCode,
      targetCurrency: toCode,
      rate,
      amountRequested,
      convertedAmount: amountRequested * rate,
      date: data?.date
    };
  } catch (error) {
    return {
      ok: false,
      tool: "getExchangeRate",
      errorCode: "EXCHANGE_API_ERROR",
      fromCurrency: fromCode,
      toCurrency: toCode,
      error: `Failed to fetch exchange rate: ${error.message}`
    };
  }
}

async function generalChat(context, userInput) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      tool: "generalChat",
      error: "Missing OPENAI_API_KEY in .env."
    };
  }

  try {
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful, concise assistant. Answer clearly and directly."
      },
      ...((Array.isArray(context) ? context : []).map((item) => ({
        role: item.role,
        content: String(item.content || "")
      }))),
      { role: "user", content: userInput }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      messages
    });

    const answer = completion.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error("No chat response returned.");
    }

    return {
      ok: true,
      tool: "generalChat",
      answer
    };
  } catch (error) {
    return {
      ok: false,
      tool: "generalChat",
      error: error.message
    };
  }
}

module.exports = { getWeather, calculateMath, getExchangeRate, generalChat };
