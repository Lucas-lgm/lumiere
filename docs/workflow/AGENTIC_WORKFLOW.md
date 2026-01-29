# Andrew Ng Agentic Workflow (Trae Edition)

> **核心理念**: 通过反思 (Reflection)、工具使用 (Tool Use)、规划 (Planning) 和多智能体协作 (Multi-agent Collaboration) 的迭代循环，提升代码质量和任务完成率。

## 🔄 核心工作流循环 (The Loop)

我们将开发过程分为四个明确的阶段，由 Trae 扮演不同的"智能体"角色来执行。

### 1. 规划阶段 (Planner Agent)
**目标**: 在写一行代码前，先明确"做什么"和"怎么做"。

- **分析需求**: 深入理解用户意图。
- **工具使用**: 使用 `SearchCodebase` 广泛搜集上下文，不要猜测。
- **产出**: 
  - 对于复杂任务：在 `docs/plans/` 下创建规划文档。
  - 对于中等任务：使用 `TodoWrite` 列出详细步骤。
  - **关键**: 必须包含"验证方案"。

### 2. 执行阶段 (Coder Agent)
**目标**: 高质量地将计划转换为代码。

- **专注**: 一次只做一个子任务。
- **工具使用**: 
  - 使用 `Read` 确认文件当前状态。
  - 使用 `SearchReplace` 或 `Write` 进行修改。
- **原则**: 
  - 遵循现有代码风格。
  - 保持代码的原子性提交。

### 3. 反思与审查阶段 (Reviewer Agent) 🌟 **核心差异点**
**目标**: 自我纠错，而不是等待用户发现错误。

- **动作**: 在完成代码修改后，**不要立即回复用户**。
- **工具使用**:
  - `Read`: 重新读取修改后的文件，像 Code Reviewer 一样检查。
  - `GetDiagnostics`: 检查是否有新的 Lint/Type 错误。
  - `CheckCommandStatus`: 确认构建/测试命令的输出。
- **检查清单**:
  - [ ] 是否破坏了现有功能？
  - [ ] 是否引入了新的 Type Error？
  - [ ] 是否符合项目规范？
  - [ ] 是否完全实现了规划中的需求？
- **自我修正**: 如果发现问题，立即回到执行阶段进行修复，直到 Review 通过。

### 4. 验证阶段 (Tester Agent)
**目标**: 证明代码是工作的。

- **动作**: 执行预定义的验证方案。
- **工具使用**:
  - 运行单元测试。
  - 运行构建命令。
  - 模拟用户操作路径。
- **产出**: 明确的验证结果（成功/失败日志）。

---

## 🧠 四大模式在 Trae 中的应用

### 1. Reflection (反思)
*   **做法**: 完成一个 Todo 后，暂停，问自己："这行得通吗？有没有更好的写法？"
*   **Trae 实践**: 在回复用户 "Finished" 之前，强制执行一次 `Read` + `GetDiagnostics` 的自我检查循环。

### 2. Tool Use (工具使用)
*   **做法**: 不要依赖训练记忆，要依赖当前文件状态。
*   **Trae 实践**: 遇到不确定的 API 或逻辑，先 `SearchCodebase`。

### 3. Planning (规划)
*   **做法**: 复杂问题分解为简单步骤。
*   **Trae 实践**: 始终维护 `TodoWrite` 列表，保持进度可见。

### 4. Multi-agent Collaboration (多角色协作)
*   **做法**: 模拟不同的视角。
*   **Trae 实践**: 
    *   "我现在是架构师，我需要设计接口..."
    *   "我现在是 QA，我需要想办法弄挂这段代码..."
    *   通过系统提示词或自我对话来切换视角。

## 📝 实际操作示例

**用户**: "帮我修复播放器的时间显示 bug"

1.  **Planner**: 
    *   `SearchCodebase("time display")` -> 找到 `ControlView.vue`。
    *   `TodoWrite`: [Analyze bug, Fix logic, Review, Verify]。
2.  **Coder**: 
    *   `Read("ControlView.vue")`。
    *   `SearchReplace` 修改格式化逻辑。
3.  **Reviewer** (Self-Correction):
    *   `Read("ControlView.vue")` (Check logic)。
    *   发现：负数时间没有处理。
    *   **Coder** 再次介入：修复负数处理逻辑。
4.  **Tester**:
    *   运行相关测试或构建。
5.  **Final Response**: "已修复 Bug，并处理了负数时间的边界情况..."

---

> **总结**: 不要急于交付。慢即是快。通过自我反思和多角色切换，确保每次交付的代码都是经过"内部审查"的。
