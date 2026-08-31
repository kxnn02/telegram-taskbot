import { InMemoryTaskStore } from "./inMemoryTaskStore.js";
import { runTaskStoreContractTests } from "./taskStoreContract.js";

runTaskStoreContractTests("InMemoryTaskStore", () => ({
  store: new InMemoryTaskStore(),
  cohortId: "cohort-5",
  otherCohortId: "cohort-4",
}));
