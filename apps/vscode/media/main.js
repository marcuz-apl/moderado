"use strict";
(function() {
  const vscode = acquireVsCodeApi();
  let state = {
    lastSequence: 0,
    turns: [],
    status: "idle",
    hasSequenceGap: false
  };
  let attachedContext;
  const transcriptContainer = document.getElementById("transcript-container");
  const statusBadge = document.getElementById("status-badge");
  const composerInput = document.getElementById("composer-input");
  const sendBtn = document.getElementById("send-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const newTaskBtn = document.getElementById("new-task-btn");
  const selectModelBtn = document.getElementById("select-model-btn");
  const attachSelectionBtn = document.getElementById("attach-selection-btn");
  const contextChipContainer = document.getElementById("context-chip-container");
  const contextChipLabel = document.getElementById("context-chip-label");
  const contextChipRemove = document.getElementById("context-chip-remove");
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function renderDiff(diffText) {
    const lines = diffText.split("\n");
    const rendered = lines.map((line) => {
      let cls = "diff-line";
      if (line.startsWith("+") && !line.startsWith("+++")) {
        cls += " added";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        cls += " removed";
      }
      return `<div class="${cls}">${escapeHtml(line)}</div>`;
    });
    return `<div class="diff-view">${rendered.join("")}</div>`;
  }
  function renderApprovalCard(card) {
    const isPending = card.status === "pending";
    let payloadHtml = "";
    if (card.exactPayload.diffPreview) {
      payloadHtml = renderDiff(card.exactPayload.diffPreview);
    } else if (card.exactPayload.command) {
      const cmdStr = card.exactPayload.command.join(" ");
      const cwdStr = card.exactPayload.cwd ? `
(cwd: ${card.exactPayload.cwd})` : "";
      payloadHtml = `<div class="approval-payload">$ ${escapeHtml(cmdStr)}${escapeHtml(cwdStr)}</div>`;
    } else if (card.exactPayload.contentPreview) {
      payloadHtml = `<div class="approval-payload">${escapeHtml(card.exactPayload.contentPreview)}</div>`;
    }
    const actionsHtml = isPending ? `<div class="approval-actions">
           <button class="btn btn-danger reject-btn" data-request-id="${escapeHtml(card.requestId)}">Reject</button>
           <button class="btn btn-primary approve-btn" data-request-id="${escapeHtml(card.requestId)}">Approve</button>
         </div>` : `<div class="approval-actions"><span class="status-badge">${escapeHtml(card.status.toUpperCase())}</span></div>`;
    return `
      <div class="approval-card ${isPending ? "" : "resolved"}" data-request-id="${escapeHtml(card.requestId)}">
        <div class="approval-header">
          <span>Action Required: ${escapeHtml(card.actionSummary)}</span>
          <span class="approval-badge">${escapeHtml(card.toolName)}</span>
        </div>
        ${payloadHtml}
        ${actionsHtml}
      </div>
    `;
  }
  function renderTool(tool) {
    const isRunning = tool.status === "running";
    return `
      <details class="tool-card" ${isRunning ? "open" : ""}>
        <summary class="tool-header">
          <span class="tool-title">\u26A1 ${escapeHtml(tool.toolName)}</span>
          <span class="tool-status">${escapeHtml(tool.status)}</span>
        </summary>
        ${tool.resultPreview ? `<div class="tool-body">${escapeHtml(tool.resultPreview)}</div>` : ""}
      </details>
    `;
  }
  function renderTurn(turn) {
    const userPromptHtml = turn.userPrompt ? `<div class="user-bubble">${escapeHtml(turn.userPrompt)}</div>` : "";
    const assistantHtml = turn.assistantText ? `<div class="assistant-bubble"><div class="assistant-text">${escapeHtml(turn.assistantText)}</div></div>` : "";
    const progressHtml = turn.progress ? `<div class="progress-card">
           <div class="progress-spinner"></div>
           <span>[Step ${turn.progress.step}/${turn.progress.maxSteps}] ${escapeHtml(turn.progress.status)}</span>
         </div>` : "";
    const toolsHtml = turn.tools.map((t) => renderTool(t)).join("");
    const approvalsHtml = turn.approvals.map((a) => renderApprovalCard(a)).join("");
    return `
      <div class="turn-block">
        ${userPromptHtml}
        ${assistantHtml}
        ${progressHtml}
        ${toolsHtml}
        ${approvalsHtml}
      </div>
    `;
  }
  function render() {
    const isBusy = state.status === "busy";
    statusBadge.textContent = isBusy ? "Working..." : "Idle";
    statusBadge.className = `status-badge ${isBusy ? "busy" : ""}`;
    cancelBtn.style.display = isBusy ? "inline-block" : "none";
    const turnsToRender = [...state.turns];
    if (state.currentTurn) {
      turnsToRender.push(state.currentTurn);
    }
    if (turnsToRender.length === 0) {
      transcriptContainer.innerHTML = `
        <div class="turn-block" id="empty-state">
          <div class="assistant-bubble">
            <p><strong>Welcome to Moderado.</strong></p>
            <p>Ask a question, describe a change, or attach editor context to begin.</p>
          </div>
        </div>
      `;
    } else {
      transcriptContainer.innerHTML = turnsToRender.map((t) => renderTurn(t)).join("");
      const approveButtons = transcriptContainer.querySelectorAll(".approve-btn");
      approveButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const reqId = e.currentTarget.getAttribute("data-request-id");
          if (reqId) {
            vscode.postMessage({ type: "approve", requestId: reqId });
          }
        });
      });
      const rejectButtons = transcriptContainer.querySelectorAll(".reject-btn");
      rejectButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const reqId = e.currentTarget.getAttribute("data-request-id");
          if (reqId) {
            vscode.postMessage({ type: "reject", requestId: reqId });
          }
        });
      });
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
  }
  function handleSend() {
    const text = composerInput.value.trim();
    if (!text) return;
    composerInput.value = "";
    const payload = {
      type: "send",
      text
    };
    if (attachedContext) {
      payload.context = {
        selection: attachedContext
      };
      attachedContext = void 0;
      contextChipContainer.style.display = "none";
    }
    vscode.postMessage(payload);
  }
  sendBtn.addEventListener("click", handleSend);
  cancelBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
  });
  newTaskBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "newSession" });
  });
  if (selectModelBtn) {
    selectModelBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "selectModel" });
    });
  }
  attachSelectionBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "attachSelection" });
  });
  contextChipRemove.addEventListener("click", () => {
    attachedContext = void 0;
    contextChipContainer.style.display = "none";
  });
  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "state") {
      state = message.state;
      render();
    } else if (message.type === "activeEditorContext") {
      attachedContext = message.context;
      if (attachedContext) {
        contextChipLabel.textContent = `${attachedContext.relativePath}:${attachedContext.startLine}-${attachedContext.endLine}`;
        contextChipContainer.style.display = "inline-block";
      } else {
        contextChipContainer.style.display = "none";
      }
    }
  });
})();
