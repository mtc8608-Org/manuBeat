-- ════════════════════════════════════════════════════════════════════════════
--  seed-sample-surveys.sql — Sample answers for the Patient Registration survey
--
--  Runs after 01-init-db.sql (alphabetically later on a fresh volume).
--
--  Survey: Patient Registration (seeded in 01-init-db.sql, UUID f000)
--  Answer keys — demographic only:
--    e001 first_name   e002 last_name     e003 email        e004 phone
--    e005 dob          e006 sex           e00b nationality
--    e00d street       e00e city          e00f postal_code  e010 country
--    e011 emergency    e012 medical_notes
--
--  20 realistic patients. These ARE the patients shown in the Data Collection
--  area; physiological data is streamed into per-patient files there, not stored
--  here (the former Vital Signs fields e013–e019 were removed from the survey).
--
--  UUID prefix: a0000000-0000-0000-0000-XXXXXXXXXXXX
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO survey_answers (id, survey_id, answers) VALUES

  ('a0000000-0000-0000-0000-000000000001', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Alice",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Martins",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "alice.martins@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1985-03-12",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Routine admission, no prior conditions."
  }'),

  ('a0000000-0000-0000-0000-000000000002', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Bruno",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Ferreira",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "b.ferreira@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1972-07-04",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Brazilian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Hypertension history, on medication."
  }'),

  ('a0000000-0000-0000-0000-000000000003', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Clara",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Sousa",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "clara.sousa@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1990-11-21",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Post-surgery follow-up, healing well."
  }'),

  ('a0000000-0000-0000-0000-000000000004', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "David",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Nkosi",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "d.nkosi@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1965-02-18",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "South African",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Fever + hypoxia on admission. O2 therapy initiated, physician alerted."
  }'),

  ('a0000000-0000-0000-0000-000000000005', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Elena",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Ribeiro",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "elena.r@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1998-06-30",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Spanish",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Athletic resting HR, no concerns."
  }'),

  ('a0000000-0000-0000-0000-000000000006', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Femi",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Adeyemi",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "femi.a@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1980-09-14",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Nigerian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Mild BP elevation, monitoring."
  }'),

  ('a0000000-0000-0000-0000-000000000007', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Grace",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Lam",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "grace.lam@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1976-12-05",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Hong Kong",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Pre-hypertensive, SpO2 borderline. Repeat in 30 min."
  }'),

  ('a0000000-0000-0000-0000-000000000008', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Hugo",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Correia",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "hugo.c@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1993-04-22",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Post-exercise measurement, acceptable."
  }'),

  ('a0000000-0000-0000-0000-000000000009', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Isabela",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Costa",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "isa.costa@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "2001-08-17",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Brazilian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Stable. Cleared for discharge."
  }'),

  ('a0000000-0000-0000-0000-00000000000a', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "João",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Pereira",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "joao.p@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1958-01-30",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Critical. ICU transfer initiated."
  }'),

  ('a0000000-0000-0000-0000-00000000000b', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Kirra",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Anderson",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "kirra.a@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1988-05-09",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Australian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "All within normal range."
  }'),

  ('a0000000-0000-0000-0000-00000000000c', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Luís",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Mendes",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "luis.m@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1970-10-03",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Borderline BP, lifestyle advice given."
  }'),

  ('a0000000-0000-0000-0000-00000000000d', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Mia",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Fischer",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "mia.f@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1995-02-28",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "German",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Routine ward round, stable."
  }'),

  ('a0000000-0000-0000-0000-00000000000e', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Nuno",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Carvalho",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "nuno.c@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "2003-07-15",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Excellent vitals, fit for discharge."
  }'),

  ('a0000000-0000-0000-0000-00000000000f', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Olga",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Petrova",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "olga.p@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1962-03-08",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Russian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Low SpO2 on admission. O2 administered."
  }'),

  ('a0000000-0000-0000-0000-000000000010', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Pedro",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Alves",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "pedro.a@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1983-11-27",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Slightly elevated BP, monitoring."
  }'),

  ('a0000000-0000-0000-0000-000000000011', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Qian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Liu",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "qian.liu@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1979-09-01",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Chinese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Normal, routine check."
  }'),

  ('a0000000-0000-0000-0000-000000000012', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Rania",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Hassan",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "rania.h@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1991-04-14",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Egyptian",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Pre-hypertensive, medication review scheduled."
  }'),

  ('a0000000-0000-0000-0000-000000000013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Samuel",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Oliveira",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "sam.o@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1968-06-23",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Male",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Routine check, no concerns."
  }'),

  ('a0000000-0000-0000-0000-000000000014', 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000', '{
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e001": "Teresa",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e002": "Gomes",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e003": "teresa.g@example.com",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e005": "1955-12-11",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e006": "Female",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e00b": "Portuguese",
    "c51c1e5f-5cc1-4b77-8832-2d10cc97e012": "Post-op, fever and elevated BP being managed."
  }')

ON CONFLICT (id) DO NOTHING;
