/**
 * Skill dictionary for entry-level tech, QA and data roles in India. Each entry is a canonical
 * name followed by synonyms. Matching is case-insensitive and whole-word.
 *
 * Entries marked with `exactOnly` are too ambiguous to look for in free text ("C", "R", "Go"),
 * so they are only recognised when a profile or extraction lists them as a skill on their own.
 */
type Entry = readonly [canonical: string, ...synonyms: string[]];

const ENTRIES: Entry[] = [
  // Programming languages
  ["Python", "python3", "python 3"],
  ["Java", "core java", "java 8", "java8", "j2ee", "java ee"],
  ["JavaScript", "js", "java script", "ecmascript", "es6", "vanilla js"],
  ["TypeScript", "ts"],
  ["C++", "cpp", "c plus plus"],
  ["C#", "c sharp", "csharp"],
  ["C", "c programming", "c language"],
  ["Go", "golang"],
  ["R", "r programming", "r language"],
  ["Kotlin"],
  ["Swift"],
  ["PHP"],
  ["Ruby"],
  ["Rust"],
  ["Scala"],
  ["Dart"],
  ["Bash", "shell scripting", "shell script", "bash scripting"],
  ["PowerShell"],
  ["MATLAB"],
  ["VBA", "excel vba", "macros"],
  // Web
  ["HTML", "html5"],
  ["CSS", "css3"],
  ["React", "react.js", "reactjs", "react js"],
  ["Angular", "angularjs", "angular.js"],
  ["Vue.js", "vue", "vuejs", "vue js"],
  ["Next.js", "nextjs", "next js"],
  ["Node.js", "node", "nodejs", "node js"],
  ["Express.js", "express.js", "expressjs", "express js"],
  ["jQuery"],
  ["Bootstrap"],
  ["Tailwind CSS", "tailwind", "tailwindcss"],
  ["Redux"],
  ["REST API", "rest", "restful", "rest apis", "restful api", "restful apis", "rest services"],
  ["GraphQL"],
  ["Django"],
  ["Flask"],
  ["FastAPI"],
  ["Spring Boot", "springboot", "spring framework", "spring mvc"],
  ["Hibernate"],
  [".NET", "dotnet", "dot net", "asp.net", ".net core", "asp.net core"],
  ["Laravel"],
  ["Microservices", "microservice"],
  // Mobile
  ["Android", "android development"],
  ["Flutter"],
  ["React Native"],
  ["iOS", "ios development"],
  // Databases
  ["SQL", "structured query language", "sql queries"],
  ["MySQL", "my sql"],
  ["PostgreSQL", "postgres", "postgre sql", "psql"],
  ["Oracle", "oracle db", "oracle database", "pl/sql", "plsql"],
  ["SQL Server", "ms sql", "mssql", "microsoft sql server", "t-sql", "tsql"],
  ["MongoDB", "mongo", "mongo db"],
  ["Redis"],
  ["SQLite"],
  ["Firebase"],
  ["DBMS", "database management", "rdbms"],
  // Cloud and DevOps
  ["AWS", "amazon web services"],
  ["Azure", "microsoft azure"],
  ["Google Cloud", "gcp", "google cloud platform"],
  ["Docker"],
  ["Kubernetes", "k8s"],
  ["Jenkins"],
  ["CI/CD", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"],
  ["GitHub Actions"],
  ["Terraform"],
  ["Ansible"],
  ["Linux", "unix", "ubuntu"],
  ["Git", "github", "gitlab", "bitbucket", "version control"],
  ["Nginx"],
  // Testing and QA
  ["Manual Testing", "manual testing", "manual qa", "functional testing"],
  ["Automation Testing", "test automation", "automated testing", "automation testing"],
  ["Selenium", "selenium webdriver", "webdriver", "selenium ide", "selenium grid"],
  ["TestNG"],
  ["JUnit"],
  ["PyTest"],
  ["Cucumber", "bdd", "gherkin"],
  ["Cypress"],
  ["Playwright"],
  ["Appium"],
  ["Postman"],
  ["API Testing", "api testing", "rest api testing", "web services testing"],
  ["JMeter", "apache jmeter"],
  ["Performance Testing", "load testing", "stress testing"],
  ["Regression Testing"],
  ["Test Cases", "test case", "test case design", "writing test cases", "test scenarios"],
  ["Bug Tracking", "defect tracking", "bug reporting", "defect reporting", "defect management"],
  ["JIRA", "atlassian jira"],
  ["SDLC", "software development life cycle", "software development lifecycle"],
  ["STLC", "software testing life cycle", "software testing lifecycle"],
  ["Agile", "scrum", "agile methodology", "kanban"],
  ["Maven"],
  ["Gradle"],
  ["Unit Testing", "unit tests"],
  ["Black Box Testing", "black-box testing"],
  ["White Box Testing", "white-box testing"],
  ["ISTQB"],
  // Data and analytics
  ["Excel", "ms excel", "microsoft excel", "advanced excel", "excel sheets", "spreadsheets", "vlookup", "pivot tables", "pivot table"],
  ["Power BI", "powerbi", "power-bi", "microsoft power bi"],
  ["Tableau"],
  ["Looker", "looker studio", "google data studio"],
  ["Pandas"],
  ["NumPy", "numpy"],
  ["Matplotlib"],
  ["Seaborn"],
  ["Scikit-learn", "sklearn", "scikit learn"],
  ["TensorFlow"],
  ["PyTorch"],
  ["Keras"],
  ["Machine Learning", "ml"],
  ["Deep Learning"],
  ["NLP", "natural language processing"],
  ["Computer Vision", "opencv"],
  ["Statistics", "statistical analysis", "descriptive statistics", "inferential statistics"],
  ["Data Analysis", "data analytics", "analysing data", "analyzing data"],
  ["Data Visualization", "data visualisation", "dashboards", "dashboarding", "reporting dashboards"],
  ["Data Cleaning", "data wrangling", "data preprocessing", "data preparation"],
  ["ETL", "etl pipelines", "data pipelines"],
  ["Data Warehousing", "data warehouse"],
  ["Big Data", "hadoop"],
  ["Apache Spark", "spark", "pyspark"],
  ["Jupyter", "jupyter notebook", "jupyter notebooks"],
  ["Google Sheets"],
  ["A/B Testing", "ab testing"],
  ["Generative AI", "genai", "llm", "llms", "prompt engineering"],
  // CS fundamentals
  ["Data Structures and Algorithms", "dsa", "data structures", "algorithms", "data structures & algorithms"],
  ["OOP", "oops", "object oriented programming", "object-oriented programming", "oops concepts"],
  ["Operating Systems", "os concepts"],
  ["Computer Networks", "networking", "tcp/ip"],
  ["System Design"],
  ["Design Patterns"],
  // Tools and other
  ["VS Code", "visual studio code"],
  ["Visual Studio"],
  ["Eclipse"],
  ["IntelliJ IDEA", "intellij"],
  ["Figma"],
  ["Salesforce"],
  ["SAP"],
  ["ServiceNow"],
  ["Tally", "tally erp"],
  ["MS Office", "microsoft office", "ms word", "powerpoint", "ms powerpoint"],
  ["Cyber Security", "cybersecurity", "information security"],
  ["Blockchain"],
  // Soft skills often listed in fresher postings
  ["Communication", "communication skills", "verbal communication", "written communication"],
  ["Problem Solving", "problem-solving", "analytical skills", "logical thinking"],
  ["Teamwork", "team player", "collaboration"],
  ["Time Management"],
  ["English", "fluent english", "english communication"],
];

/** Too ambiguous to search for in free text; recognised only as a listed skill. */
const EXACT_ONLY = new Set(["C", "R", "Go", "ts", "js", "ml", "node", "rest", "spark", "mongo", "vue", "tailwind", "macros", "scrum", "github", "gitlab", "bitbucket", "spreadsheets", "dashboards", "networking", "collaboration", "ubuntu", "unix", "kanban", "bdd", "gherkin", "webdriver", "hadoop", "opencv", "psql", "llm", "llms", "genai"]);

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
const keyOf = (s: string) => collapse(s).toLowerCase();

const CANONICAL_BY_KEY = new Map<string, string>();
for (const [canonical, ...synonyms] of ENTRIES) {
  for (const term of [canonical, ...synonyms]) {
    const key = keyOf(term);
    if (!CANONICAL_BY_KEY.has(key)) CANONICAL_BY_KEY.set(key, canonical);
  }
}

/** The dictionary's name for a skill ("nodejs" → "Node.js"), or the input tidied up if unknown. */
export function canonicalSkill(name: string): string {
  const tidy = collapse(name);
  return CANONICAL_BY_KEY.get(tidy.toLowerCase()) ?? tidy;
}

/** Whether a name is in the dictionary (as a canonical name or synonym). */
export function isKnownSkill(name: string): boolean {
  return CANONICAL_BY_KEY.has(keyOf(name));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** One regex per searchable term. Boundaries treat + # . as word characters so "C++" ≠ "C". */
const TEXT_PATTERNS: Array<{ canonical: string; re: RegExp }> = [];
for (const [canonical, ...synonyms] of ENTRIES) {
  for (const term of [canonical, ...synonyms]) {
    if (EXACT_ONLY.has(term) || (term === canonical && EXACT_ONLY.has(canonical))) continue;
    const body = escape(collapse(term)).replace(/\\? /g, "[\\s-]+");
    TEXT_PATTERNS.push({ canonical, re: new RegExp(`(?<![A-Za-z0-9+#.])${body}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, "i") });
  }
}

/** Canonical skills mentioned in free text, sorted, each once. */
export function findSkillsInText(text: string): string[] {
  const found = new Set<string>();
  for (const { canonical, re } of TEXT_PATTERNS) {
    if (!found.has(canonical) && re.test(text)) found.add(canonical);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
