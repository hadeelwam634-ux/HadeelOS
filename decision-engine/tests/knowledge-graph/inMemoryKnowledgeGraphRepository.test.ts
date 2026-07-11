import { InMemoryKnowledgeGraphRepository } from "../../src/knowledge-graph/InMemoryKnowledgeGraphRepository";
import { runKnowledgeGraphRepositoryContractTests } from "./knowledgeGraphRepository.contract";

runKnowledgeGraphRepositoryContractTests(() => new InMemoryKnowledgeGraphRepository());
