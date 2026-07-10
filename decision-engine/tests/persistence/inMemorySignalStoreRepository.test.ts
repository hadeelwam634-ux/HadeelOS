import { runSignalStoreRepositoryContractTests } from "./signalStoreRepository.contract";
import { InMemorySignalStoreRepository } from "../../src/persistence/InMemorySignalStoreRepository";

runSignalStoreRepositoryContractTests(() => new InMemorySignalStoreRepository());
