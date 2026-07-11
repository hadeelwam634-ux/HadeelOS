import { InMemoryMemoryRepository } from "../../src/memory/InMemoryMemoryRepository";
import { runMemoryRepositoryContractTests } from "./memoryRepository.contract";

runMemoryRepositoryContractTests(() => new InMemoryMemoryRepository());
