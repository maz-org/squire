ALTER TABLE "mutation_idempotency_keys" ADD COLUMN "proposal_id" uuid;
--> statement-breakpoint
ALTER TABLE "mutation_idempotency_keys" ADD CONSTRAINT "mutation_idempotency_keys_proposal_id_pending_mutations_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "pending_mutations"("id") ON DELETE cascade ON UPDATE no action;
