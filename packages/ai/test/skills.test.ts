import { describe, expect, it } from "vitest";
import { canonicalSkill, findSkillsInText, isKnownSkill } from "../src/skills";

describe("canonicalSkill", () => {
  it("maps synonyms to one name, ignoring case and spacing", () => {
    expect(canonicalSkill("js")).toBe("JavaScript");
    expect(canonicalSkill("NodeJS")).toBe("Node.js");
    expect(canonicalSkill("node")).toBe("Node.js");
    expect(canonicalSkill("postgres")).toBe("PostgreSQL");
    expect(canonicalSkill("Advanced  Excel")).toBe("Excel");
    expect(canonicalSkill("MS Excel")).toBe("Excel");
    expect(canonicalSkill("Selenium WebDriver")).toBe("Selenium");
    expect(canonicalSkill("oops")).toBe("OOP");
    expect(canonicalSkill("DSA")).toBe("Data Structures and Algorithms");
    expect(canonicalSkill("software testing life cycle")).toBe("STLC");
    expect(canonicalSkill("powerbi")).toBe("Power BI");
    expect(canonicalSkill("c sharp")).toBe("C#");
  });

  it("keeps unknown skills, tidied", () => {
    expect(canonicalSkill("  Katalon   Studio ")).toBe("Katalon Studio");
    expect(isKnownSkill("Katalon Studio")).toBe(false);
    expect(isKnownSkill("selenium webdriver")).toBe(true);
  });

  it("has a dictionary of around 150 canonical skills", () => {
    const sample = ["Python", "Java", "SQL", "Selenium", "Postman", "JIRA", "Power BI", "Tableau", "Pandas", "Docker", "AWS", "Git", "Linux", "React", "Angular", "Django", "Flask", "Spring Boot"];
    for (const s of sample) expect(canonicalSkill(s), s).toBe(s);
  });
});

describe("findSkillsInText", () => {
  it("finds whole-word skills and returns canonical names once, sorted", () => {
    const text = "Must know Java, SQL and Selenium WebDriver. Experience with Postman for API testing is a plus. Selenium again.";
    expect(findSkillsInText(text)).toEqual(["API Testing", "Java", "Postman", "Selenium", "SQL"]);
  });

  it("does not confuse Java with JavaScript, or C++ / C# with each other", () => {
    expect(findSkillsInText("We use JavaScript and TypeScript")).toEqual(["JavaScript", "TypeScript"]);
    expect(findSkillsInText("Strong C++ skills")).toEqual(["C++"]);
    expect(findSkillsInText("Strong C# and .NET skills")).toEqual([".NET", "C#"]);
    expect(findSkillsInText("Built with Node.js.")).toEqual(["Node.js"]);
  });

  it("ignores ambiguous short names in prose", () => {
    expect(findSkillsInText("Go through the R&D docs and C the results")).toEqual([]);
    expect(findSkillsInText("excellent communication")).toEqual(["Communication"]);
  });
});
