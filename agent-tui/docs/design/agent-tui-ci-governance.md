# agent-tui CI governance

`appsdk verify` remains required for local project governance and release
operations. The hosted workflow does not install or execute AppSDK: its scope
is reproducible package, runtime, export, installation, and boundary checks.

This separation prevents a hosted AppSDK revision or bundle from becoming a
second project-governance truth. Local AppSDK verification remains the
canonical check against the project's pinned SDK and maps.
