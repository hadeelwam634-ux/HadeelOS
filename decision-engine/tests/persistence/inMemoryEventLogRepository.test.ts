import { runEventLogRepositoryContractTests } from "./eventLogRepository.contract";
import { InMemoryEventLogRepository } from "../../src/persistence/InMemoryEventLogRepository";

runEventLogRepositoryContractTests(() => new InMemoryEventLogRepository());
