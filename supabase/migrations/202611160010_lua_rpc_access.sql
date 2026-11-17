grant execute on function public.lua_key_api(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
