-- Drop all tables and indexes in reverse order of creation

drop table if exists user_bets cascade;
drop table if exists market_close cascade;
drop table if exists market_open cascade;
drop table if exists odds_ticks cascade;
drop table if exists outcomes cascade;
drop table if exists markets cascade;
drop table if exists events cascade;