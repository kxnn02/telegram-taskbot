import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { sweepStaleTestCohorts } from "../src/storage/sweepStaleTestCohorts.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("scripts/sweepStaleTestCohorts.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

const client = createClient(url, serviceRoleKey);

sweepStaleTestCohorts(client).then((deleted) => {
  if (deleted.length === 0) {
    console.log("No stale test cohorts found.");
  } else {
    console.log(`Swept ${deleted.length} stale test cohort(s): ${deleted.join(", ")}`);
  }
});
