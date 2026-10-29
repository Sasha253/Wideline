-- C08: touches are a v0 stat (PRD stats catalogue, auto-accept 0.80), so the
-- v0 contract carries them from the start.
-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'touch';
