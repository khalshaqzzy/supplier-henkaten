-- Unanswered supplemental checklist items retain their original labels and order.
-- migration-policy: allow-drop-not-null HenkatenChecklistAnswer.answer
ALTER TABLE "HenkatenChecklistAnswer" ALTER COLUMN "answer" DROP NOT NULL;
