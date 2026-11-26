"""Builds Breakline's branded Supabase auth emails into this folder.

Each .html file is pasted into Supabase -> Authentication -> Emails -> (template) -> Body,
with the matching subject from SUBJECTS below. Re-run after editing: python build.py
Email-safe on purpose: tables, inline styles, a PNG logo (most mail apps block SVG).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://www.breaklinefishing.com'
LOGO = f'{SITE}/img/logo-email.png'

def page(preheader, heading, body_html, button=None, after=''):
    btn = ''
    if button:
        label, url = button
        btn = f'''
          <tr><td align="center" style="padding:8px 0 24px;">
            <a href="{url}" style="display:inline-block;background:#35c2ff;color:#04121d;font-weight:800;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:9px;font-family:Arial,Helvetica,sans-serif;">{label}</a>
          </td></tr>'''
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>{heading}</title></head>
<body style="margin:0;padding:0;background:#07111b;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#07111b;">{preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07111b;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding:0 4px 18px;">
        <a href="{SITE}" style="text-decoration:none;color:#e8eef4;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;">
          <img src="{LOGO}" width="36" height="36" alt="" style="vertical-align:middle;border-radius:8px;border:0;margin-right:10px;">Breakline
        </a>
      </td></tr>
      <tr><td style="background:#0f1f30;border:1px solid #1d3247;border-radius:14px;padding:30px 28px 10px;font-family:Arial,Helvetica,sans-serif;color:#e8eef4;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-size:24px;font-weight:800;line-height:1.25;padding-bottom:12px;color:#ffffff;">{heading}</td></tr>
          <tr><td style="font-size:16px;line-height:1.6;color:#c4d1de;padding-bottom:20px;">{body_html}</td></tr>
          {btn}
          {after}
        </table>
      </td></tr>
      <tr><td style="padding:18px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#7f93a8;">
        Breakline · Satellite fishing charts · <a href="{SITE}" style="color:#7f93a8;">breaklinefishing.com</a><br>
        You're getting this because someone used this address on Breakline. If it wasn't you, you can ignore it.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
'''

def fallback(url_var):
    return f'''<tr><td style="font-size:13px;line-height:1.6;color:#8fa1b3;padding-bottom:22px;border-top:1px solid #1d3247;padding-top:16px;">
            Button not working? Paste this into your browser:<br>
            <a href="{url_var}" style="color:#35c2ff;word-break:break-all;">{url_var}</a>
          </td></tr>'''

def code_block(label):
    return f'''<tr><td style="padding-bottom:20px;">
            <div style="font-size:13px;color:#8fa1b3;padding-bottom:6px;">{label}</div>
            <div style="font-family:Consolas,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#ffffff;background:#07111b;border:1px solid #1d3247;border-radius:10px;padding:14px 0;text-align:center;">{{{{ .Token }}}}</div>
          </td></tr>'''

C = '{{ .ConfirmationURL }}'
TEMPLATES = {
    'confirm-signup': ('Confirm your email for Breakline', page(
        'One tap to start your 5-day free trial.',
        'Confirm your email',
        "Welcome aboard. Tap below to confirm your email and start your <b style=\"color:#ffffff;\">5-day free trial</b>: water temp, color, altimetry, currents and where to fish, offshore and inshore.",
        ('Confirm my email', C), fallback(C))),
    'magic-link': ('Your Breakline sign-in link', page(
        'Tap to sign in to Breakline.',
        'Sign in to Breakline',
        'Tap below to sign in. The link works once and expires in an hour.',
        ('Sign in', C), fallback(C))),
    'reset-password': ('Reset your Breakline password', page(
        'Set a new password for Breakline.',
        'Reset your password',
        "Someone (hopefully you) asked to reset your Breakline password. Tap below to choose a new one. If you didn't ask, ignore this email and your password stays the same.",
        ('Choose a new password', C), fallback(C))),
    'change-email': ('Confirm your new email for Breakline', page(
        'Confirm the new email address on your Breakline account.',
        'Confirm your new email',
        'Tap below to switch your Breakline account from <b style="color:#ffffff;">{{ .Email }}</b> to <b style="color:#ffffff;">{{ .NewEmail }}</b>.',
        ('Confirm new email', C), fallback(C))),
    'invite': ("You're invited to Breakline", page(
        "You've been invited to Breakline.",
        "You're invited to Breakline",
        'Satellite fishing charts: water temp, color, altimetry, currents and where to fish. Tap below to accept and set up your account.',
        ('Accept invite', C), fallback(C))),
    'reauthentication': ('Your Breakline verification code', page(
        'Your Breakline verification code.',
        'Confirm it\'s you',
        'Enter this code in Breakline to continue. It expires shortly.',
        None, code_block('Verification code'))),
}

if __name__ == '__main__':
    lines = ['# Subjects (paste each with its .html body)\n']
    for name, (subject, html) in TEMPLATES.items():
        open(os.path.join(HERE, f'{name}.html'), 'w', encoding='utf-8').write(html)
        lines.append(f'- {name}.html: {subject}')
    open(os.path.join(HERE, 'SUBJECTS.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('built', len(TEMPLATES))
