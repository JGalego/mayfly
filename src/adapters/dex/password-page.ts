// Dex v2.46.1's web/templates/password.html (Apache-2.0, https://github.com/dexidp/dex), changed by Mayfly: an eye shows
// the password, and phones neither capitalise nor correct what people type. Copy it again when the Dex image changes.
export const PASSWORD_PAGE = `{{ template "header.html" . }}

<style>
  .mayfly-password { margin: auto; position: relative; width: 260px; }
  .mayfly-password .theme-form-input { padding-right: 40px; }
  .mayfly-eye { align-items: center; background: none; border: 0; border-radius: 8px; color: #667085; cursor: pointer; display: flex; height: 40px; justify-content: center; position: absolute; right: 0; top: 0; width: 40px; }
  .mayfly-eye:hover, .mayfly-eye:focus-visible { color: #1a1a1a; }
  .mayfly-eye:focus-visible { outline: 2px solid #4A90D9; outline-offset: -4px; }
  .mayfly-eye svg { fill: none; height: 18px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 18px; }
</style>

<div class="theme-panel">
  <h2 class="theme-heading">Log in to Your Account</h2>
  <form method="post" action="{{ .PostURL }}">
    <div class="theme-form-row">
      <div class="theme-form-label">
        <label for="login">{{ .UsernamePrompt }}</label>
      </div>
      <input tabindex="1" required id="login" name="login" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" class="theme-form-input" placeholder="{{ .UsernamePrompt | lower }}" {{ if .Username }} value="{{ .Username }}" {{ else }} autofocus {{ end }}/>
    </div>
    <div class="theme-form-row">
      <div class="theme-form-label">
        <label for="password">Password</label>
      </div>
      <div class="mayfly-password">
        <input tabindex="2" required id="password" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" class="theme-form-input" placeholder="password" {{ if .Invalid }} autofocus {{ end }}/>
        <button id="show-password" type="button" class="mayfly-eye" aria-controls="password" aria-pressed="false" aria-label="Show password" title="Show password">
          <svg id="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg id="eye-off" viewBox="0 0 24 24" aria-hidden="true" style="display: none"><path d="M3 3l18 18"/><path d="M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9"/><path d="M6.6 6.6C3.7 8.3 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
        </button>
      </div>
    </div>

    {{ if .Invalid }}
      <div id="login-error" class="dex-error-box">
        Invalid {{ .UsernamePrompt }} and password.
      </div>
    {{ end }}

    {{ if .ShowRememberMe }}
    <div class="theme-form-row">
      <label class="theme-remember-me">
        <input tabindex="3" type="checkbox" name="remember_me" {{ if .RememberMeChecked }}checked{{ end }}/>
        Remember me
      </label>
    </div>
    {{ end }}

    <button tabindex="4" id="submit-login" type="submit" class="dex-btn theme-btn--primary">Login</button>

  </form>
  {{ if .BackLink }}
  <div class="theme-link-back">
    <a class="dex-subtle-text" href="{{ .BackLink }}">Select another login method.</a>
  </div>
  {{ end }}
</div>


<script type="text/javascript">
  (function () {
    var password = document.querySelector('#password');
    var eye = document.querySelector('#show-password');

    function show(shown) {
      var label = shown ? 'Hide password' : 'Show password';
      password.type = shown ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(shown));
      eye.setAttribute('aria-label', label);
      eye.title = label;
      document.querySelector('#eye').style.display = shown ? 'none' : '';
      document.querySelector('#eye-off').style.display = shown ? '' : 'none';
    }

    eye.onclick = function () {
      show(password.type === 'password');
      password.focus();
    };

    document.querySelector('form').onsubmit = function () {
      // Hidden again on the way out, so the browser offers to save it as a password.
      show(false);
      document.querySelector('#submit-login').setAttribute('disabled', 'disabled');
    };
  })();
</script>

{{ template "footer.html" . }}
`;
