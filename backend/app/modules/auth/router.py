from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    LoginRequest,
    RefreshRequest,
    RegistrationOut,
    RegisterRequest,
    ForgotPasswordOut,
    ForgotPasswordRequest,
    PasswordResetRequest,
    ResendVerificationOut,
    ResendVerificationRequest,
    TokenResponse,
    UserOut,
    VerifyEmailOut,
    VerifyEmailRequest,
)
from app.modules.auth.service import (
    authenticate_user,
    refresh_session,
    register_user,
    resend_email_verification,
    request_password_reset,
    reset_password,
    revoke_refresh_session,
    verify_email_token,
)

router = APIRouter()


@router.post("/register", response_model=RegistrationOut, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    return register_user(db, payload)


@router.post("/resend-verification", response_model=ResendVerificationOut)
def resend_verification(
    payload: ResendVerificationRequest,
    db: Session = Depends(get_db),
):
    return resend_email_verification(db, payload.email)


@router.get("/verify-email", response_class=HTMLResponse)
def verify_email_page():
    return HTMLResponse(
        """<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="referrer" content="no-referrer"><title>ShopFlow email verification</title>
        <style>body{font-family:sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#17191c}
        main{padding:24px;border:1px solid #e4e7ec;border-radius:16px}h1{font-size:24px}</style></head>
        <body><main><h1 id="title">Verify your email</h1><p id="message">Select the button to confirm this email address.</p>
        <button id="verify" hidden style="padding:12px 18px;border:0;border-radius:10px;background:#f47b20;color:#fff;font-weight:700">Verify email address</button></main>
        <script>
        const title=document.getElementById('title');
        const message=document.getElementById('message');
        const button=document.getElementById('verify');
        const token=new URLSearchParams(location.hash.slice(1)).get('token');
        history.replaceState(null,'',location.pathname+location.search);
        if(!token){title.textContent='Email not verified';message.textContent='This link is invalid or incomplete.';}
        else{
          button.hidden=false;
          button.addEventListener('click',async()=>{
            button.disabled=true;
            message.textContent='Verifying…';
            try{
              const response=await fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
              const result=await response.json();
              title.textContent=response.ok?'Email verified':'Email not verified';
              message.textContent=result.message||'This verification link is invalid or expired.';
              button.hidden=true;
            }catch(_){button.disabled=false;message.textContent='Could not verify. Check your connection and try again.';}
          });
        }
        </script></body></html>""",
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        },
    )


@router.post("/verify-email", response_model=VerifyEmailOut)
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    try:
        verify_email_token(db, payload.token)
    except HTTPException as error:
        raise error
    return {
        "verified": True,
        "message": "Your ShopFlow email is verified. Return to the app and sign in.",
    }


@router.get("/password-reset", response_class=HTMLResponse)
def password_reset_page():
    return HTMLResponse(
        """<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="referrer" content="no-referrer"><title>Reset ShopFlow password</title>
        <style>body{font-family:sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#17191c}main{padding:24px;border:1px solid #e4e7ec;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}button{border:0;border-radius:10px;background:#f47b20;color:#fff;font-weight:700}</style></head>
        <body><main><h1>Reset your password</h1><p id="message">Choose a new password to continue.</p>
        <form id="form" hidden><label>New password<input id="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
        <small>Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.</small><button id="submit">Reset password</button></form></main>
        <script>
        const message=document.getElementById('message');const form=document.getElementById('form');const button=document.getElementById('submit');
        const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname+location.search);
        if(!token){message.textContent='This reset link is invalid or incomplete.';}else{form.hidden=false;form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;message.textContent='Resetting password…';
        try{const response=await fetch(location.pathname+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,new_password:document.getElementById('password').value})});const result=await response.json();message.textContent=response.ok?result.message:(typeof result.detail==='string'?result.detail:'Password reset failed. Check the password and try again.');if(response.ok)form.hidden=true;else button.disabled=false;}
        catch(_){button.disabled=false;message.textContent='Could not reset the password. Check your connection and try again.';}});}</script></body></html>""",
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        },
    )


@router.post("/password-reset/request", response_model=ForgotPasswordOut, status_code=202)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    request_password_reset(db, payload.email)
    return {"message": "If an eligible account exists, a password reset email will be sent."}


@router.post("/password-reset/confirm")
def confirm_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    reset_password(db, payload.token, payload.new_password)
    return {"message": "Your password has been reset. Return to ShopFlow and sign in."}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    return authenticate_user(db, payload.email, payload.password)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    return refresh_session(db, payload.refresh_token)


@router.post("/logout", status_code=204)
def logout(payload: RefreshRequest, db: Session = Depends(get_db)):
    revoke_refresh_session(db, payload.refresh_token)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
