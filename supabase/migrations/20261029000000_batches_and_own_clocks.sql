-- Batches and own clocks. A plan is either a batch (shared by several goals; a goal can join
-- part-way through) or a goal's own clock (solo: one goal, starting the day it was committed).
-- Safe to run more than once.
alter table public.plans add column if not exists solo boolean not null default false;
