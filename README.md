# 🤖 Smart CLI AI Agent - Assignment 1

A sophisticated, multi-step AI Agent built with **Node.js** and **OpenAI**. This agent doesn't just chat; it **thinks, plans, and executes** real-world tools to provide accurate, data-driven answers in fluent Hebrew.

---

## 🌟 Overview

This project implements an **Agentic Workflow**. Unlike standard chatbots, this agent uses a **Router Logic** to decide its next move. It analyzes user intent and determines if it can answer directly or if it needs to trigger external tools. 

The agent supports **Persistent Memory**, allowing it to maintain context (like your name or location) across different sessions.

---

## 🚀 Key Features

* 🧠 **Autonomous Orchestration**: The agent can run multiple reasoning steps (e.g., comparing weather in two different cities) before formulating a final answer.
* 💾 **Persistent Context**: All conversations and tool results are saved in `history.json`, enabling long-term memory.
* 🛠️ **Real-time Toolbelt**:
    * ☀️ **Weather**: Live data via OpenWeatherMap API.
    * 🧮 **Math Engine**: Complex expression evaluation using `mathjs`.
    * 💱 **Currency Pro**: Up-to-date exchange rates via the Frankfurter API.
* 🇮🇱 **Hebrew Native**: Specialized in providing natural, friendly Hebrew responses regardless of the technical data processed.
* 🛡️ **Resilient Logic**: Built-in "Repair Logic" for failed tool calls and fallback summarization to ensure the user always gets an answer.

---

## 🏗️ System Architecture

The system is built on three main pillars:

### 1. The Orchestrator (`main.js`)
The "Heart" of the agent. It manages the `while` loop that keeps the agent thinking until a "Final Answer" state is reached. It syncs the history after every tool call to keep the LLM updated.

### 2. The Toolbelt (`tools.js`)
The "Hands" of the agent. Contains modular JavaScript logic for API interactions, parameter normalization (e.g., mapping "Dollar" to "USD"), and error handling.

### 3. The Memory (`history.json`)
The "Brain's Storage". A JSON-based persistence layer that records every user turn, tool output, and assistant reply.

---

## 🛠️ Technical Stack

* **Runtime**: Node.js
* **LLM**: OpenAI GPT-4o-mini
* **Math Logic**: Math.js
* **External APIs**: OpenWeatherMap, Frankfurter.app

---

## ⚙️ Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone [https://github.com/liorshaya/ai_course_hw1.git](https://github.com/liorshaya/ai_course_hw1.git)
    cd ai_course_hw1
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Create a `.env` file in the root directory (This file is ignored by Git for security):
    ```env
    OPENAI_API_KEY=your_openai_key_here
    OPENWEATHER_API_KEY=your_openweather_key_here
    CHAT_MODEL=gpt-4o-mini
    ROUTER_MODEL=gpt-4o-mini
    ```

4.  **Launch the Agent**:
    ```bash
    node main.js
    ```

---

## 💬 Usage & Capabilities

| User Input | Agent Logic |
| :--- | :--- |
| "כמה חם באשקלון?" | Calls `getWeather`, summarizes in Hebrew. |
| "כמה זה 150 דולר ביורו?" | Executes `getExchangeRate` with auto-conversion. |
| "מי חם יותר, דובאי או לונדון?" | Performs **two** weather calls, compares results. |
| "איך קוראים לי?" | Reads from `history.json` to recall personal details. |

---

## 📜 Credits
Developed by **Lior** as part of the AI Course at **Ashkelon Academic College**.

> **Note to Lecturer:** The `history.json` file is included in this repository to demonstrate successful execution of various scenarios including math, weather comparisons, and memory retention.
