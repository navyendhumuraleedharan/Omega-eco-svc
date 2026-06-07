# AI_DISCLOSURE.md

# AI Tools Disclosure

In accordance with the assessment guidelines, this document outlines the usage of AI assistance during the development of the Durable Game Economy Service.

### Tools Used
* **Gemini (Large Language Model)**: Used as a pair-programming assistant, architectural sounding board, and documentation refiner.
* **ChatGPT (Large Language Model)**: Used as a pair-programming assistant, architectural sounding board, and documentation refiner.

### Scope of Assistance
1. **Code Generation & Review**: Assisted in structuring the Express routes, refinement of the PostgreSQL atomic transaction blocks (`BEGIN...COMMIT`), and implementing the database row-locking syntax (`FOR UPDATE`).
2. **Integration Test Scaffolding**: Helped construct the parallel execution script (`Promise.all()`) within Jest/Supertest to safely simulate concurrent race conditions.
3. **Documentation Alignment**: Assisted in formatting and polishing the structural layout of `README.md` and `DESIGN.md` to ensure clear presentation of the system's crash-resilience properties.

### Approximate Contribution Breakdown
* **Core Architecture & Database Schema**: Designed entirely by myself; AI used to audit constraint syntax.
* **Application Logic & Concurrency Control**: ~70% driven by myself, ~30% AI code generation/syntax verification.
* **Documentation & Markdown Formatting**: Collaborative composition and formatting layout optimization.