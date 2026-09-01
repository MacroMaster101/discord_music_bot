// Token sign-in for the public /login page. Cloudflare Access gates /admin and
// /api/admin at the edge, so this path verifies against the ungated /console/api
// mirror and then opens the console at /console.
(() => {
  const form = document.getElementById('login-form');
  const input = document.getElementById('admin-token');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  const meter = document.getElementById('meter');
  const readout = document.getElementById('readout');
  if (!form) return;

  // The meter is the status display, so every state change goes through here and the
  // readout stays in step with it.
  const LABELS = {
    standby: 'Standby',
    typing: 'Ready',
    checking: 'Checking',
    rejected: 'Rejected',
    authorized: 'Authorized',
  };

  function setState(state) {
    meter.dataset.state = state;
    readout.textContent = LABELS[state] || LABELS.standby;
  }

  input.addEventListener('input', () => {
    if (meter.dataset.state === 'checking' || meter.dataset.state === 'authorized') return;
    message.textContent = '';
    setState(input.value.trim() ? 'typing' : 'standby');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    message.textContent = '';
    submit.disabled = true;
    setState('checking');

    try {
      // Verify before storing so a bad token reports here rather than bouncing the
      // operator into a console that immediately locks itself.
      const res = await fetch('/console/api/stats', {
        headers: { Authorization: `Bearer ${value}` },
      });

      if (res.ok) {
        sessionStorage.setItem('musicAdminToken', value);
        setState('authorized');
        // Hold the authorized state briefly so the meter reads before the page moves.
        setTimeout(() => { window.location.href = '/console'; }, 420);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setState('rejected');
      // Only the token was offered here, so the shared endpoint's "session or token"
      // wording would be misleading. Pass the server's text through when it explains
      // something this page cannot know — being throttled, or no token configured.
      message.textContent = (res.status === 429 || res.status === 503)
        ? (data.error || 'Sign-in is unavailable right now.')
        : 'That token was rejected.';
      submit.disabled = false;
      input.select();
    } catch (error) {
      setState('rejected');
      message.textContent = 'Could not reach the server. Try again.';
      submit.disabled = false;
    }
  });
})();
