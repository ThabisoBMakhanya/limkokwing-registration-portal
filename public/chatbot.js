'use strict';
(() => {
  const root = document.getElementById('chat-root');
  if (!root) return;

  const token = () => localStorage.getItem('lck_token');
  const user = () => {
    try { return JSON.parse(localStorage.getItem('lck_user') || 'null'); }
    catch (_) { return null; }
  };
  const suggestions = () => {
    const u = user();
    if (!u) return [
      'What are the EGCSE requirements for the IT Degree?',
      'What is the IGCSE cut-off for a Bachelors degree?',
      'How do I apply?'
    ];
    if (u.role === 'student') return [
      'What modules do I have next semester?',
      'What is my registration status?',
      'Do I have pending modules?'
    ];
    return [
      'How many applications are pending?',
      'How many fee receipts need verification?',
      'How do I add a module?'
    ];
  };

  root.innerHTML = `
    <button class="chat-fab" id="chat-toggle" type="button" aria-label="Open registration assistant" aria-expanded="false">Help</button>
    <section class="chat-panel" id="chat-panel" aria-label="Limkokwing registration assistant" aria-hidden="true">
      <header class="chat-head">
        <div><b>Registration Assistant</b><small>Limkokwing Eswatini</small></div>
        <button class="chat-close" id="chat-close" type="button" aria-label="Close assistant">Close</button>
      </header>
      <div class="chat-body" id="chat-body" aria-live="polite" aria-relevant="additions">
        <div class="msg bot">Hello! I can help with admissions, programme requirements, registration and results.</div>
      </div>
      <div class="chat-suggest" id="chat-suggest"></div>
      <form class="chat-input" id="chat-form">
        <input id="chat-message" name="message" autocomplete="off" maxlength="2000" aria-label="Message the assistant" placeholder="Ask a question" required>
        <button class="btn btn-sm" type="submit">Send</button>
      </form>
    </section>`;

  const panel = document.getElementById('chat-panel');
  const toggle = document.getElementById('chat-toggle');
  const body = document.getElementById('chat-body');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-message');
  const suggest = document.getElementById('chat-suggest');

  function setOpen(open) {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { renderSuggestions(); input.focus(); }
  }
  function renderSuggestions() {
    suggest.replaceChildren();
    for (const text of suggestions()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => send(text));
      suggest.append(button);
    }
  }
  function addMessage(text, kind) {
    const item = document.createElement('div');
    item.className = `msg ${kind}`;
    // The API uses lightweight Markdown for emphasis. Escape first, then enable bold only.
    item.innerHTML = String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    body.append(item);
    body.scrollTop = body.scrollHeight;
    return item;
  }
  async function send(message) {
    const question = String(message || '').trim();
    if (!question) return;
    addMessage(question, 'user');
    input.value = '';
    suggest.replaceChildren();
    const typing = document.createElement('div');
    typing.className = 'msg bot chat-typing';
    typing.setAttribute('aria-label', 'Assistant is typing');
    typing.textContent = 'Typing';
    body.append(typing);
    body.scrollTop = body.scrollHeight;
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    try {
      const response = await fetch('/api/chatbot', {
        method: 'POST', headers, body: JSON.stringify({ message: question })
      });
      const data = await response.json();
      typing.remove();
      if (!response.ok) throw new Error(data.error || 'The assistant is unavailable. Contact admissions@limkokwing.ac.sz.');
      addMessage(data.reply || 'Please contact admissions@limkokwing.ac.sz for help.', 'bot');
    } catch (error) {
      typing.remove();
      addMessage(`${error.message} You can also contact admissions@limkokwing.ac.sz or registry@limkokwing.ac.sz.`, 'bot');
    }
    renderSuggestions();
  }

  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  document.getElementById('chat-close').addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', event => { event.preventDefault(); send(input.value); });
  renderSuggestions();
})();

