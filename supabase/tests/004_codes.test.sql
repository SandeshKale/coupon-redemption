-- §8 codes: normalisation, generation, display, masking.
begin;
select plan(17);

select is(public.normalise_code(tests.code13('P24-0000001')), (select code::text from public.coupon where serial = 'P24-0000001'), 'normalises a valid code');
select is(public.normalise_code(lower(public.display_code(tests.code13('P24-0000001')))), (select code::text from public.coupon where serial = 'P24-0000001'), 'grouped lowercase');
select is(public.normalise_code('HTTPS://C.EXAMPLE.IN/C/' || tests.code13('P24-0000001')), (select code::text from public.coupon where serial = 'P24-0000001'), 'URL prefix stripped');
select is(public.normalise_code(left(tests.code13('P24-0000001'), 12)), null, 'EC-006 12 characters rejected');
select is(public.normalise_code('U' || right(tests.code13('P24-0000001'), 12)), null, 'EC-004 U rejected');
select is(public.normalise_code(null), null, 'null input');
select is(public.normalise_code('10AAAAAAAAAA' || public.luhn32_check_char('10AAAAAAAAAA')), '10AAAAAAAAAA', 'canonical');
select is(public.normalise_code('ILAAAAAAAAAA' || public.luhn32_check_char('11AAAAAAAAAA')), '11AAAAAAAAAA', 'EC-003 I/L → 1');
select is(public.normalise_code('O0AAAAAAAAAA' || public.luhn32_check_char('00AAAAAAAAAA')), '00AAAAAAAAAA', 'EC-003 O → 0');
select ok((select bool_and(public.gen_code12() ~ '^[0-9A-HJKMNP-TV-Z]{12}$') from generate_series(1, 500)), 'gen_code12 uses the alphabet only');
select is((select count(distinct c)::int from (select public.gen_code12() as c from generate_series(1, 2000)) x), 2000, 'no collisions in 2,000 codes');
select ok((select count(distinct ch) from (select substr(public.gen_code12(), 1, 1) as ch from generate_series(1, 3000)) x) = 32, 'all 32 characters appear');
select ok((select bool_and(public.gen_token6() ~ '^[0-9A-HJKMNP-TV-Z]{6}$' and public.gen_token6() ~ '[0-9]') from generate_series(1, 500)), 'tokens have a digit (ADR-0003)');
select is(public.display_code('7KQ2M9XHTB4RJ'), '7KQ2-M9XH-TB4R-J', 'display grouping');
select is(public.mask_phone('+919812344521'), '+91 98•••• 4521', 'Indian mask');
select is(public.mask_phone('+447700900123'), '+44 •••• 0123', 'foreign mask');
select is(public.mask_phone('+91 98•••• 4521'), '+91 98•••• 4521', 'masking is idempotent');

select * from finish();
rollback;
