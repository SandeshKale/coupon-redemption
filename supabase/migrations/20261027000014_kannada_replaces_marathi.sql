-- 0014: Kannada replaces Marathi for painter WhatsApp replies. Rows are converted in place
-- (no deletes): the 'mr' templates become 'kn' with Kannada text, and any painter stored as 'mr'
-- falls back to the default Hindi + English.

alter table public.painter drop constraint painter_lang_check;
alter table public.wa_template drop constraint wa_template_lang_check;

update public.painter set lang = 'hi+en' where lang = 'mr';

update public.wa_template t
   set lang = 'kn',
       body = k.body
  from (values
    ('CONFIRMED', '✅ ಧನ್ಯವಾದ! {dealer} ಅವರಿಂದ ₹{amount} ದೃಢೀಕರಿಸಲಾಗಿದೆ (ಕೂಪನ್ {serial}). ನಿಮಗೆ ಹಣ ಸಿಗದಿದ್ದರೆ NO ಎಂದು ಉತ್ತರಿಸಿ.'),
    ('CONFIRMED_BATCH', '✅ ಧನ್ಯವಾದ! {dealer} ಅವರಿಂದ {count} ಕೂಪನ್‌ಗಳಿಗೆ ₹{amount} ದೃಢೀಕರಿಸಲಾಗಿದೆ. ನಿಮಗೆ ಹಣ ಸಿಗದಿದ್ದರೆ NO ಎಂದು ಉತ್ತರಿಸಿ.'),
    ('ALREADY_CONFIRMED', 'ನೀವು ಈ ಪಾವತಿಯನ್ನು ಈಗಾಗಲೇ ದೃಢೀಕರಿಸಿದ್ದೀರಿ. ಧನ್ಯವಾದ!'),
    ('TOKEN_USED', 'ಈ ಕೋಡ್ ಈಗಾಗಲೇ ಬಳಕೆಯಾಗಿದೆ. ಇದು ತಪ್ಪಾಗಿದ್ದರೆ {helpline} ಗೆ ಕರೆ ಮಾಡಿ.'),
    ('UNKNOWN_TOKEN', 'ಈ ಕೋಡ್ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಡೀಲರ್‌ನ ಫೋನ್‌ನಲ್ಲಿರುವ QR ಅನ್ನು ಮತ್ತೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.'),
    ('EXPIRED', 'ಈ ಕೋಡ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಡೀಲರ್‌ಗೆ ಹೊಸ QR ತೋರಿಸಲು ಹೇಳಿ, ಅಥವಾ {helpline} ಗೆ ಕರೆ ಮಾಡಿ.'),
    ('DISPUTE_RECORDED', 'ಕ್ಷಮಿಸಿ. ನಿಮಗೆ ಹಣ ಸಿಕ್ಕಿಲ್ಲ ಎಂದು ನಾವು ದಾಖಲಿಸಿದ್ದೇವೆ. 24M 2 ಕೆಲಸದ ದಿನಗಳೊಳಗೆ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತದೆ.'),
    ('HELP', 'ಈ ಸಂಖ್ಯೆ 24M ಪೇಂಟರ್ ಕೂಪನ್ ಪಾವತಿಗಳನ್ನು ದೃಢೀಕರಿಸುತ್ತದೆ. ನಿಮ್ಮ ಡೀಲರ್‌ನ ಫೋನ್‌ನಲ್ಲಿರುವ QR ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಮತ್ತು Send ಒತ್ತಿ. ಸಹಾಯ: {helpline}'),
    ('PRIVACY', 'ನಿಮ್ಮ ಸಂಖ್ಯೆಯನ್ನು ನಾವು ಕೂಪನ್ ಪಾವತಿಗಳನ್ನು ದೃಢೀಕರಿಸಲು ಮಾತ್ರ, 3 ವರ್ಷಗಳ ಕಾಲ ಬಳಸುತ್ತೇವೆ. ಗೌಪ್ಯತೆ: {url}. ನಿಮ್ಮ ಸಂಖ್ಯೆ ತೆಗೆಯಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.'),
    ('STOPPED', 'ನಿಮ್ಮ ಸಂಖ್ಯೆಯನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಧನ್ಯವಾದ.')
  ) as k (key, body)
 where t.lang = 'mr' and t.key = k.key;

alter table public.painter
  add constraint painter_lang_check check (lang in ('hi+en', 'en', 'hi', 'kn'));
alter table public.wa_template
  add constraint wa_template_lang_check check (lang in ('en', 'hi', 'kn'));
