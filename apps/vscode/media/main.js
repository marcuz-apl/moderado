/* Moderado webview protocol (host is authoritative):
 * In:  {type:'state', state:{sessionId?,status?,turns?,currentTurn?,
 *        recentSessions?,provider?,providers?,models?,modelId?,approvals?,
 *        pendingApprovals?,usage?,about?,error?}}
 *      {type:'event',event:AgentEvent} may accompany state updates.
 * Out: {protocolVersion:1,requestId:string,type:'start_turn',sessionId,prompt,mode}
 *      similarly cancel_turn, resume_session, select_provider,
 *      select_model, resolve_approval, update_settings; {type:'ready'} handshakes.
 * Host must validate every intent and enforce approvals; the webview is presentation only.
 */
(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const approvalLabels = {
    read: 'Read files', edit: 'Edit files', web_fetch: 'Fetch web content',
    execute: 'Execute commands', mcp: 'Use MCP servers',
  };
  const defaultApprovals = { read: true, edit: true, web_fetch: true, execute: false, mcp: false };
  const state = { approvals: { ...defaultApprovals }, turns: [], recentSessions: [], providers: [], models: [], pendingApprovals: [] };
  let view = 'chat';
  let mode = 'act';
  let selectedProvider = '';
  let composerDraft = '';
  let sessionId = crypto.randomUUID();

  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <button class="brand" id="home" type="button" aria-label="Moderado home"><span class="brand-mark" aria-hidden="true">M</span><span>Moderado</span></button>
        <div class="top-actions"><button class="icon-button" id="new-session" type="button" title="New chat" aria-label="New chat">＋</button><button class="icon-button" id="settings-button" type="button" title="Settings" aria-label="Settings">⚙</button></div>
      </header>
      <main id="content"></main>
      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
    </div>`;
  const content = document.getElementById('content');
  const notice = document.getElementById('notice');
  const post = (message) => vscode.postMessage(message.type === 'ready' ? message : {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    ...message,
  });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const button = (label, className, action) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  const array = (value) => Array.isArray(value) ? value : [];

  document.getElementById('home').addEventListener('click', () => { view = 'chat'; render(); });
  document.getElementById('settings-button').addEventListener('click', () => { view = 'settings'; render(); });
  document.getElementById('new-session').addEventListener('click', () => {
    sessionId = crypto.randomUUID();
    state.turns = [];
    state.currentTurn = undefined;
    state.status = 'idle';
    view = 'chat';
    render();
  });

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function render() {
    content.replaceChildren();
    content.append(view === 'settings' ? renderSettings() : renderChat());
    showNotice(text(state.error));
  }

  function renderChat() {
    const page = el('section', 'chat-page');
    const conversation = el('div', 'conversation');
    conversation.setAttribute('aria-label', 'Conversation');
    conversation.setAttribute('role', 'log');
    const turns = array(state.turns);
    if (!turns.length && !state.currentTurn) {
      const welcome = el('div', 'welcome');
      welcome.append(el('div', 'welcome-mark', 'M'), el('p', 'eyebrow', 'YOUR CODING PARTNER'), el('h1', '', 'What can I help you build?'), el('p', 'muted', 'Ask a question, plan a change, or describe a task in your workspace.'));
      conversation.append(welcome);
    } else {
      for (const turn of [...turns, ...(state.currentTurn ? [state.currentTurn] : [])]) conversation.append(renderTurn(turn));
    }
    const pending = array(state.pendingApprovals).filter((item) => item && item.status !== 'approved' && item.status !== 'denied');
    for (const item of pending) conversation.append(renderApproval(item));
    page.append(conversation);

    if (!turns.length && !state.currentTurn && array(state.recentSessions).length) {
      const recent = el('section', 'recent');
      recent.append(el('h2', 'section-title', 'Recent sessions'));
      for (const session of array(state.recentSessions).slice(0, 5)) {
        if (!session || typeof session.id !== 'string') continue;
        const row = button(text(session.title, 'Untitled session'), 'recent-row', () => { sessionId = session.id; post({ type: 'resume_session', sessionId }); });
        row.append(el('span', 'recent-arrow', '↗'));
        recent.append(row);
      }
      page.append(recent);
    }

    const dock = el('div', 'chat-dock');
    dock.append(renderApprovalSummary());
    const composer = el('form', 'composer');
    const input = el('textarea', 'composer-input');
    input.placeholder = 'Ask Moderado to help with your code…';
    input.setAttribute('aria-label', 'Message Moderado');
    input.rows = 3;
    input.value = composerDraft;
    input.addEventListener('input', () => { composerDraft = input.value; });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
    });
    composer.append(input);
    const controls = el('div', 'composer-controls');
    const segmented = el('div', 'mode-toggle');
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', 'Task mode');
    for (const value of ['plan', 'act']) {
      const control = button(value === 'plan' ? 'Plan' : 'Act', mode === value ? 'mode active' : 'mode', () => { mode = value; render(); input.focus(); });
      control.setAttribute('aria-pressed', String(mode === value));
      segmented.append(control);
    }
    controls.append(segmented);
    const model = state.model || array(state.models).find((item) => item && item.id === state.modelId);
    controls.append(el('span', 'model-indicator', text(model?.name || model?.label || state.modelId, 'Choose a free model in Settings')));
    if (state.status === 'busy' || state.currentTurn) controls.append(button('Stop', 'stop-button', () => post({ type: 'cancel_turn', sessionId })));
    else controls.append(button('Send ↑', 'send-button', () => composer.requestSubmit()));
    composer.append(controls);
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || state.status === 'busy') return;
      post({ type: 'start_turn', sessionId, prompt: message, mode: mode === 'plan' ? 'Plan' : 'Execute' });
      composerDraft = '';
      input.value = '';
    });
    dock.append(composer);
    if (state.usage && Number.isFinite(state.usage.totalTokens)) {
      dock.append(el('div', 'usage', `${state.usage.totalTokens.toLocaleString()} tokens used${Number.isFinite(state.usage.tokensPerSecond) ? ` · ${state.usage.tokensPerSecond.toFixed(1)} tokens/s` : ''}`));
    }
    page.append(dock);
    queueMicrotask(() => { conversation.scrollTop = conversation.scrollHeight; });
    return page;
  }

  function renderTurn(turn) {
    const wrapper = el('article', 'turn');
    if (turn.userPrompt) {
      const user = el('div', 'message user-message');
      user.append(el('p', 'speaker', 'You'), el('div', 'message-text', turn.userPrompt));
      wrapper.append(user);
    }
    const assistant = el('div', 'message assistant-message');
    assistant.append(el('p', 'speaker', 'Moderado'));
    if (turn.assistantText) assistant.append(el('div', 'message-text', turn.assistantText));
    else if (turn.status === 'running') assistant.append(el('div', 'working', 'Working…'));
    for (const tool of array(turn.tools)) {
      if (!tool) continue;
      assistant.append(el('div', 'activity', `${text(tool.toolName, 'Action')} · ${text(tool.status, 'running')}`));
    }
    for (const approval of array(turn.approvals)) if (approval?.status === 'pending') assistant.append(renderApproval(approval));
    if (turn.errorMessage) assistant.append(el('div', 'inline-error', turn.errorMessage));
    wrapper.append(assistant);
    return wrapper;
  }

  function renderApproval(item) {
    const card = el('section', 'approval-card');
    card.append(el('p', 'eyebrow', 'APPROVAL REQUIRED'), el('h3', '', text(item.actionSummary || item.toolName, 'Review action')));
    if (item.exactPayload !== undefined) {
      const preview = el('pre', 'approval-preview', typeof item.exactPayload === 'string' ? item.exactPayload : JSON.stringify(item.exactPayload, null, 2));
      card.append(preview);
    }
    if (typeof item.requestId === 'string') {
      const actions = el('div', 'approval-actions');
      actions.append(button('Deny', 'secondary-button', () => post({ type: 'resolve_approval', sessionId, approvalRequestId: item.requestId, status: 'denied' })), button('Approve', 'primary-button', () => post({ type: 'resolve_approval', sessionId, approvalRequestId: item.requestId, status: 'approved' })));
      card.append(actions);
    }
    return card;
  }

  function renderApprovalSummary() {
    const bar = el('div', 'approval-summary');
    const enabled = Object.entries(approvalLabels).filter(([key]) => state.approvals[key]).map(([, label]) => label.replace(' files', '').replace(' web content', ' web').replace(' servers', ''));
    bar.append(el('span', 'summary-dot'), el('span', '', `Auto-approve: ${enabled.join(', ') || 'none'}`));
    bar.append(button('Manage', 'text-button', () => { view = 'settings'; render(); }));
    return bar;
  }

  function renderSettings() {
    const page = el('section', 'settings-page');
    const title = el('div', 'settings-heading');
    title.append(button('←', 'back-button', () => { view = 'chat'; render(); }), el('h1', '', 'Settings'));
    page.append(title);
    const tabs = el('nav', 'settings-nav');
    tabs.setAttribute('aria-label', 'Settings pages');
    const current = state.settingsPage === 'about' ? 'about' : 'api';
    for (const [key, label] of [['api', 'API Configuration'], ['about', 'About']]) {
      const tab = button(label, key === current ? 'settings-tab active' : 'settings-tab', () => { state.settingsPage = key; render(); });
      tab.setAttribute('aria-current', key === current ? 'page' : 'false');
      tabs.append(tab);
    }
    page.append(tabs, current === 'about' ? renderAbout() : renderApiSettings());
    return page;
  }

  function renderApiSettings() {
    const pane = el('div', 'settings-content');
    pane.append(el('p', 'eyebrow', 'MODEL CONNECTION'), el('h2', '', 'API Configuration'), el('p', 'muted', 'Connect a provider, then choose a verified free model.'));
    const providerField = el('label', 'field');
    providerField.append(el('span', 'field-label', 'Provider'));
    const providerSelect = el('select', 'input');
    providerSelect.setAttribute('aria-label', 'Provider');
    providerSelect.append(new Option('Choose a provider', ''));
    for (const provider of array(state.providers)) {
      if (!provider || typeof provider.id !== 'string') continue;
      providerSelect.append(new Option(text(provider.name || provider.label, provider.id), provider.id));
    }
    providerSelect.value = selectedProvider || text(state.providerId || state.provider?.id);
    providerSelect.addEventListener('change', () => { selectedProvider = providerSelect.value; post({ type: 'select_provider', providerId: selectedProvider }); render(); });
    providerField.append(providerSelect);
    pane.append(providerField);
    if (providerSelect.value) pane.append(button('Connect and verify', 'primary-button connect-button', () => post({ type: 'select_provider', providerId: providerSelect.value })));
    pane.append(el('p', 'muted small', 'Credentials and local endpoints are requested securely by VS Code when needed.'));
    if (state.connectionStatus) pane.append(el('p', state.connectionStatus === 'connected' ? 'connection-ok' : 'inline-error', state.connectionStatus === 'connected' ? 'Connected and verified' : text(state.connectionStatus)));
    pane.append(el('h3', 'list-heading', 'Free Models'));
    const models = array(state.models).filter((item) => item && (item.verifiedFree === true || item.free === true || item.freeStatus === 'verified'));
    if (models.length) {
      const list = el('div', 'model-list');
      for (const model of models) {
        const id = text(model.id);
        if (!id) continue;
        const row = button('', model.id === state.modelId ? 'model-row selected' : 'model-row', () => post({ type: 'select_model', providerId: providerSelect.value, modelId: id }));
        row.append(el('span', 'model-name', text(model.name || model.label, id)), el('span', 'free-badge', 'Verified free'));
        if (model.evidence) row.append(el('span', 'model-evidence', model.evidence));
        list.append(row);
      }
      pane.append(list);
    } else pane.append(el('p', 'empty-models', providerSelect.value ? 'No verified free models are available for this provider yet.' : 'Choose and connect a provider to see its verified free models.'));
    pane.append(el('h3', 'list-heading', 'Auto-approval'));
    pane.append(el('p', 'muted small', 'Checked actions run automatically and still appear in the activity timeline. Unchecked actions ask every time.'));
    const approvals = el('div', 'approval-options');
    for (const [key, label] of Object.entries(approvalLabels)) {
      const field = el('label', 'checkbox-row');
      const input = el('input'); input.type = 'checkbox'; input.checked = state.approvals[key] === true;
      input.addEventListener('change', () => post({ type: 'update_settings', category: key, enabled: input.checked }));
      field.append(input, el('span', '', label));
      approvals.append(field);
    }
    pane.append(approvals);
    return pane;
  }

  function renderAbout() {
    const pane = el('div', 'settings-content about');
    pane.append(el('div', 'about-mark', 'M'), el('h2', '', 'Moderado'), el('p', 'muted', 'An AI coding assistant for your workspace.'));
    const version = text(state.about?.version, 'Unknown');
    const license = text(state.about?.license, 'See repository');
    const facts = el('dl', 'facts');
    for (const [label, value] of [['Version', version], ['License', license]]) {
      facts.append(el('dt', '', label), el('dd', '', value));
    }
    pane.append(facts);
    const links = el('div', 'about-links');
    for (const [key, label] of [['documentation', 'Documentation'], ['repository', 'Repository'], ['issues', 'Report an issue']]) {
      const url = state.about?.[key];
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) continue;
      const anchor = el('a', '', `${label} ↗`);
      anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      links.append(anchor);
    }
    pane.append(links);
    return pane;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'state' && message.state && typeof message.state === 'object') {
      const next = message.state;
      Object.assign(state, next);
      if (typeof next.sessionId === 'string') sessionId = next.sessionId;
      if (next.approvals && typeof next.approvals === 'object') state.approvals = { ...defaultApprovals, ...next.approvals };
      render();
    } else if (message.type === 'error') {
      showNotice(text(message.message, 'Something went wrong.'));
    } else if (message.protocolVersion === 1 && message.ok === false) {
      showNotice(text(message.message, 'The action could not be completed.'));
    }
  });
  render();
  post({ type: 'ready' });
})();
