# Providers

ZuvCode has a provider abstraction so the runtime is not owned by one AI company.

Implemented in this milestone:

- OpenAI-compatible provider adapter
- Ollama provider adapter
- Provider registry and status view
- Environment-variable secret references
- Session-only secret resolver
- Shared user configuration and cached model lists across projects
- Windows DPAPI credential persistence (private mode-0600 credential file on other systems)
- Live model listing where a configured provider is reachable
- Built-in model registry fallback when no provider is configured

Configured secrets are references such as `env:OPENAI_API_KEY`; secret values are not written to project files.

`/connect` provides presets for Ollama, LM Studio, OpenRouter, OpenAI, DeepSeek, Groq, Mistral, xAI, and custom OpenAI-compatible endpoints. It discovers models and opens a picker. Providers without an implemented adapter are not offered in this connection picker.

`/model` searches cached models, switches the active model, refreshes discovery, adds a model ID or opens a new connection. Manual addition needs only a provider choice and model ID. Discovery has a 10-second timeout; chat has a 120-second timeout. Escape cancels either request. Failed connections offer an endpoint/key correction or manual model registration.

User settings are in `~/.zuvcode/config.json` and credentials in `~/.zuvcode/credentials.json`; override this folder with `ZUVCODE_HOME`. On Windows, keys are encrypted for the current user and cannot be moved to another Windows account as plaintext. On other operating systems, the credential file is permission-restricted rather than encrypted.
