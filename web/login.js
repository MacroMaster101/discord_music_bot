// Token sign-in for the public /login page. Cloudflare Access gates /admin and
// /api/admin at the edge, so this path verifies against the ungated /console/api
// mirror and then opens the console at /console.
(() => {
  const form = document.getElementById('login-form');
  const input = document.getElementById('admin-token');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    message.textContent = '';
    submit.disabled = true;

    try {
      // Verify before storing so a bad token reports here rather than bouncing the
      // operator into a console that immediately locks itself.
      const res = await fetch('/console/api/stats', {
        headers: { Authorization: `Bearer ${value}` },
      });

      if (res.ok) {
        sessionStorage.setItem('j4fnAdminToken', value);
        window.location.href = '/console';
        return;
      }

      const data = await res.json().catch(() => ({}));
      // Surface the throttle message so a locked-out operator knows to wait.
      message.textContent = data.error || 'That token was rejected.';
    } catch (error) {
      message.textContent = 'Could not reach the server. Try again.';
    } finally {
      submit.disabled = false;
    }
  });
})();
