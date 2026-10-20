-- Hubs get the location details Uncommon already had: area, city and whether the hub is open.
-- No capacity column: places are set per intake (intakes.places_total) until real hub numbers are confirmed.
alter table public.hubs
  add column slug text unique,
  add column area text,
  add column city text,
  add column status text not null default 'open' check (status in ('open', 'coming_soon', 'closed'));

-- The 13 Uncommon hubs, kept from the earlier database (same ids).
insert into public.hubs (id, name, slug, area, city, status) values
  ('e3f6f268-e2c0-4aa3-85ad-cf36b5ddf2ae', 'Dzivarasekwa Innovation Hub', 'dzivarasekwa-innovation-hub', 'Dzivarasekwa', 'Harare', 'open'),
  ('73c7cd11-a119-4509-82da-878d52c370aa', 'Nicki Keszler Innovation Hub', 'kuwadzana-innovation-hub', 'Kuwadzana', 'Harare', 'open'),
  ('bc97e0d0-6e8b-41a1-89f3-80021190b14d', 'Mufakose Innovation Hub', 'mufakose-innovation-hub', 'Mufakose', 'Harare', 'open'),
  ('5affd775-2dc8-439d-b648-c15326e2bcac', 'Warren Park Innovation Hub', 'warren-park-innovation-hub', 'Warren Park', 'Harare', 'open'),
  ('d7c1232b-ac96-41be-bdf4-3f13462393bd', 'Kambuzuma Innovation Hub', 'kambuzuma-innovation-hub', 'Kambuzuma', 'Harare', 'open'),
  ('24eaf942-5aad-4eca-a9d5-0db9e37e16bc', 'Mbare Innovation Hub', 'mbare-innovation-hub', 'Mbare', 'Harare', 'open'),
  ('33ca2ef2-f534-4bba-992c-6d46f4ae1567', 'Renate Dommasch Foundation Innovation Hub', 'renate-dommasch-foundation-innovation-hub', 'Chitungwiza', 'Harare', 'coming_soon'),
  ('6c707246-d6d6-4373-968b-17c442bba8cb', 'Nedbank Innovation Hub', 'emganwini-innovation-hub', 'Emganwini', 'Bulawayo', 'open'),
  ('666866eb-5a51-4854-a5fa-24992e85cc10', 'Sally Foundation Innovation Hub', 'sally-foundation-innovation-hub', 'Sizinda', 'Bulawayo', 'open'),
  ('2b568618-19c2-4a33-ae56-a3db5e2ce171', 'Vincent Bohlen Innovation Hub', 'vincent-bohlen-innovation-hub', 'Mkhosana', 'Victoria Falls', 'open'),
  ('1056dc18-329d-4347-898d-ca085b1b9654', 'Jafuta Innovation Hub', 'jafuta-innovation-hub', 'Jafuta', 'Victoria Falls', 'open'),
  ('0dbf8914-0a7e-44cf-8d11-9022a768e9d8', 'Painted Dog Conservation Innovation Hub', 'gwayi-innovation-hub', 'Gwayi', 'Victoria Falls', 'open'),
  ('016cc926-4a5d-4382-82d3-0c146c29cc9f', 'Nyamuroro VTC Innovation Hub', 'nyamuroro-vtc-innovation-hub', 'Nyamuroro', 'Gokwe', 'coming_soon')
on conflict (id) do nothing;
