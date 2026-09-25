declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

interface ToolActivity {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  resultPreview?: string;
  timestamp: number;
}

interface PendingApprovalCard {
  requestId: string;
  toolName: string;
  actionSummary: string;
  exactPayload: {
    targetFile?: string;
    diffPreview?: string;
    contentPreview?: string;
    command?: string[];
    cwd?: string;
  };
  status: 'pending' | 'approved' | 'denied' | 'aborted';
  timestamp: number;
}

interface ProgressState {
  step: number;
  maxSteps: number;
  status: string;
}

interface TurnState {
  id: string;
  userPrompt?: string;
  assistantText: string;
  modelId?: string;
  progress?: ProgressState;
  tools: ToolActivity[];
  approvals: PendingApprovalCard[];
  status: 'running' | 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
  timestamp: number;
}

interface TranscriptState {
  sessionId?: string;
  lastSequence: number;
  turns: TurnState[];
  currentTurn?: TurnState;
  hasSequenceGap: boolean;
  status: 'idle' | 'busy' | 'error';
}

interface EditorSelectionContext {
  relativePath: string;
  startLine: number;
  endLine: number;
  text?: string;
}

(function () {
  const vscode = acquireVsCodeApi();

  let state: TranscriptState = {
    lastSequence: 0,
    turns: [],
    status: 'idle',
    hasSequenceGap: false,
  };

  let attachedContext: EditorSelectionContext | undefined;

  const transcriptContainer = document.getElementById('transcript-container') as HTMLElement;
  const statusBadge = document.getElementById('status-badge') as HTMLElement;
  const composerInput = document.getElementById('composer-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
  const newTaskBtn = document.getElementById('new-task-btn') as HTMLButtonElement;
  const selectModelBtn = document.getElementById('select-model-btn') as HTMLButtonElement | null;
  const attachSelectionBtn = document.getElementById('attach-selection-btn') as HTMLButtonElement;
  const contextChipContainer = document.getElementById('context-chip-container') as HTMLElement;
  const contextChipLabel = document.getElementById('context-chip-label') as HTMLElement;
  const contextChipRemove = document.getElementById('context-chip-remove') as HTMLElement;
  const sidecarBanner = document.getElementById('sidecar-banner') as HTMLElement | null;
  const sidecarBannerMessage = document.getElementById('sidecar-banner-message') as HTMLElement | null;
  const sidecarRetryBtn = document.getElementById('sidecar-retry-btn') as HTMLElement | null;
  const attachFileBtn = document.getElementById('attach-file-btn') as HTMLElement | null;
  const statusProviderBtn = document.getElementById('status-provider-btn') as HTMLElement | null;
  const statusModelBtn = document.getElementById('status-model-btn') as HTMLElement | null;

  function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderDiff(diffText: string): string {
    const lines = diffText.split('\n');
    const rendered = lines.map((line) => {
      let cls = 'diff-line';
      if (line.startsWith('+') && !line.startsWith('+++')) {
        cls += ' added';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        cls += ' removed';
      }
      return `<div class="${cls}">${escapeHtml(line)}</div>`;
    });
    return `<div class="diff-view">${rendered.join('')}</div>`;
  }

  function renderApprovalCard(card: PendingApprovalCard): string {
    const isPending = card.status === 'pending';
    let payloadHtml = '';

    if (card.exactPayload.diffPreview) {
      payloadHtml = renderDiff(card.exactPayload.diffPreview);
    } else if (card.exactPayload.command) {
      const cmdStr = card.exactPayload.command.join(' ');
      const cwdStr = card.exactPayload.cwd ? `\n(cwd: ${card.exactPayload.cwd})` : '';
      payloadHtml = `<div class="approval-payload">$ ${escapeHtml(cmdStr)}${escapeHtml(cwdStr)}</div>`;
    } else if (card.exactPayload.contentPreview) {
      payloadHtml = `<div class="approval-payload">${escapeHtml(card.exactPayload.contentPreview)}</div>`;
    }

    const actionsHtml = isPending
      ? `<div class="approval-actions">
           <button class="btn btn-danger reject-btn" data-request-id="${escapeHtml(card.requestId)}">Reject</button>
           <button class="btn btn-primary approve-btn" data-request-id="${escapeHtml(card.requestId)}">Approve</button>
         </div>`
      : `<div class="approval-actions"><span class="status-badge">${escapeHtml(card.status.toUpperCase())}</span></div>`;

    return `
      <div class="approval-card ${isPending ? '' : 'resolved'}" data-request-id="${escapeHtml(card.requestId)}">
        <div class="approval-header">
          <span>Action Required: ${escapeHtml(card.actionSummary)}</span>
          <span class="approval-badge">${escapeHtml(card.toolName)}</span>
        </div>
        ${payloadHtml}
        ${actionsHtml}
      </div>
    `;
  }

  function renderTool(tool: ToolActivity): string {
    const isRunning = tool.status === 'running';
    return `
      <details class="tool-card" ${isRunning ? 'open' : ''}>
        <summary class="tool-header">
          <span class="tool-title">⚡ ${escapeHtml(tool.toolName)}</span>
          <span class="tool-status">${escapeHtml(tool.status)}</span>
        </summary>
        ${tool.resultPreview ? `<div class="tool-body">${escapeHtml(tool.resultPreview)}</div>` : ''}
      </details>
    `;
  }

  function renderTurn(turn: TurnState): string {
    const userPromptHtml = turn.userPrompt
      ? `<div class="user-bubble">${escapeHtml(turn.userPrompt)}</div>`
      : '';

    const assistantHtml = turn.assistantText
      ? `<div class="assistant-bubble"><div class="assistant-text">${escapeHtml(turn.assistantText)}</div></div>`
      : '';

    const progressHtml = turn.progress
      ? `<div class="progress-card">
           <div class="progress-spinner"></div>
           <span>[Step ${turn.progress.step}/${turn.progress.maxSteps}] ${escapeHtml(turn.progress.status)}</span>
         </div>`
      : '';

    const toolsHtml = turn.tools.map((t) => renderTool(t)).join('');
    const approvalsHtml = turn.approvals.map((a) => renderApprovalCard(a)).join('');

    // Error turns must be visible, and provider failures are the common case,
    // so offer the model manager directly instead of making the user hunt for it.
    const errorHtml =
      turn.status === 'error' && turn.errorMessage
        ? `<div class="turn-error">
             <div class="turn-error-message">${escapeHtml(turn.errorMessage)}</div>
             <div class="turn-error-actions">
               <button class="btn btn-secondary error-switch-model-btn">Switch model</button>
             </div>
           </div>`
        : '';

    return `
      <div class="turn-block">
        ${userPromptHtml}
        ${assistantHtml}
        ${progressHtml}
        ${toolsHtml}
        ${approvalsHtml}
        ${errorHtml}
      </div>
    `;
  }

  function render(): void {
    const isBusy = state.status === 'busy';
    statusBadge.textContent = isBusy ? 'Working...' : 'Idle';
    statusBadge.className = `status-badge ${isBusy ? 'busy' : ''}`;
    cancelBtn.style.display = isBusy ? 'inline-block' : 'none';

    const turnsToRender: TurnState[] = [...state.turns];
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
      transcriptContainer.innerHTML = turnsToRender.map((t) => renderTurn(t)).join('');
      // Attach approval event listeners
      const approveButtons = transcriptContainer.querySelectorAll('.approve-btn');
      approveButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const reqId = (e.currentTarget as HTMLElement).getAttribute('data-request-id');
          if (reqId) {
            vscode.postMessage({ type: 'approve', requestId: reqId });
          }
        });
      });

      const rejectButtons = transcriptContainer.querySelectorAll('.reject-btn');
      rejectButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const reqId = (e.currentTarget as HTMLElement).getAttribute('data-request-id');
          if (reqId) {
            vscode.postMessage({ type: 'reject', requestId: reqId });
          }
        });
      });

      const switchModelButtons = transcriptContainer.querySelectorAll('.error-switch-model-btn');
      switchModelButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'selectModel' });
        });
      });

      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
  }

  function showSidecarUnavailable(message: string): void {
    if (!sidecarBanner) return;
    if (sidecarBannerMessage) {
      sidecarBannerMessage.textContent = message;
    }
    sidecarBanner.style.display = 'flex';
    // The composer cannot do anything without a sidecar; disable it explicitly
    // so the UI never implies a send would work.
    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    attachSelectionBtn.disabled = true;
  }

  function hideSidecarUnavailable(): void {
    if (!sidecarBanner) return;
    sidecarBanner.style.display = 'none';
    sendBtn.disabled = false;
    cancelBtn.disabled = false;
    attachSelectionBtn.disabled = false;
  }

  function handleSend(): void {
    const text = composerInput.value.trim();
    if (!text) return;

    composerInput.value = '';
    const payload: any = {
      type: 'send',
      text,
    };

    if (attachedContext) {
      payload.context = {
        selection: attachedContext,
      };
      attachedContext = undefined;
      contextChipContainer.style.display = 'none';
    }

    vscode.postMessage(payload);
  }

  // Event Listeners
  sendBtn.addEventListener('click', handleSend);

  cancelBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  newTaskBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'newSession' });
  });

  if (selectModelBtn) {
    selectModelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'selectModel' });
    });
  }

  attachSelectionBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'attachSelection' });
  });

  contextChipRemove.addEventListener('click', () => {
    attachedContext = undefined;
    contextChipContainer.style.display = 'none';
  });

  composerInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'attachFile' });
    });
  }

  if (statusProviderBtn) {
    statusProviderBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'selectProvider' });
    });
  }

  if (statusModelBtn) {
    statusModelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'selectModel' });
    });
  }

  if (sidecarRetryBtn) {
    sidecarRetryBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'retrySidecar' });
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'state') {
      state = message.state;
      render();
    } else if (message.type === 'activeEditorContext') {
      attachedContext = message.context;
      if (attachedContext) {
        contextChipLabel.textContent = `${attachedContext.relativePath}:${attachedContext.startLine}-${attachedContext.endLine}`;
        contextChipContainer.style.display = 'inline-block';
      } else {
        contextChipContainer.style.display = 'none';
      }
    } else if (message.type === 'sidecarUnavailable') {
      showSidecarUnavailable(message.message);
    } else if (message.type === 'sidecarReady') {
      hideSidecarUnavailable();
    } else if (message.type === 'appendComposerText') {
      composerInput.value += message.text;
      composerInput.focus();
    } else if (message.type === 'modelStatus') {
      if (statusProviderBtn) {
        statusProviderBtn.textContent = message.needsApiKey
          ? `${message.providerId || 'No provider'} — needs API key`
          : message.providerId || 'No provider connected';
      }
      if (statusModelBtn) {
        statusModelBtn.textContent = message.modelId || 'Auto (Free-First)';
      }
    }
  });
})();
