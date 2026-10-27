-- 0014: Kannada replaces Marathi for painter replies.
begin;
select plan(7);

select is((select count(*)::int from public.wa_template where lang = 'kn'), 10, 'ten Kannada templates');
select is((select count(*)::int from public.wa_template where lang = 'mr'), 0, 'no Marathi templates left');
select is((select count(*)::int from public.wa_template where lang = 'kn' and body !~ '[ಀ-೿]'), 0, 'every Kannada template contains Kannada script');
select ok(public.reply_text('HELP', 'kn') like '%ಸಹಾಯ%', 'reply_text renders a Kannada template');
select ok(public.reply_text('HELP', 'kn') not like '%{helpline}%', 'placeholders are filled');
select throws_ok($$update public.painter set lang = 'mr' where false; insert into public.painter (phone_hash, phone_masked, lang) values ('\x01', 'x', 'mr')$$, '23514', null, 'painter.lang rejects mr');
select throws_ok($$insert into public.wa_template (key, lang, body) values ('X', 'mr', 'x')$$, '23514', null, 'wa_template.lang rejects mr');

select * from finish();
rollback;
