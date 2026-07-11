import { InMemoryExperimentRepository } from "../../src/learning/InMemoryExperimentRepository";
import { runExperimentRepositoryContractTests } from "./experimentRepository.contract";

runExperimentRepositoryContractTests(() => new InMemoryExperimentRepository());
