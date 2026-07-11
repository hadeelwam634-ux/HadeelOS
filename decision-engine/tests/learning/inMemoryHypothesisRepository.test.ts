import { InMemoryHypothesisRepository } from "../../src/learning/InMemoryHypothesisRepository";
import { runHypothesisRepositoryContractTests } from "./hypothesisRepository.contract";

runHypothesisRepositoryContractTests(() => new InMemoryHypothesisRepository());
