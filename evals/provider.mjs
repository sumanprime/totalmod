// promptfoo provider: each test's prompt is the raw request text a user types into the widget.
// Needs ANTHROPIC_API_KEY (paid). Model: TOTALMOD_MODEL, else totalmod.config.yaml's default.
// With TOTALMOD_LLM=ollama or lmstudio and TOTALMOD_MODEL, it runs on that local model instead.
import { runCase } from "./run-case.ts";

export default class TotalmodInterviewerProvider {
  id() {
    return "totalmod-interviewer";
  }

  async callApi(prompt) {
    const result = await runCase(prompt);
    return result.error
      ? { error: result.error, output: JSON.stringify(result) }
      : { output: JSON.stringify(result) };
  }
}
