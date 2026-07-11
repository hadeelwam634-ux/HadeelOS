import { InMemoryDigitalTwinRepository } from "../../src/twin/InMemoryDigitalTwinRepository";
import { runDigitalTwinRepositoryContractTests } from "./digitalTwinRepository.contract";

runDigitalTwinRepositoryContractTests(() => new InMemoryDigitalTwinRepository());
