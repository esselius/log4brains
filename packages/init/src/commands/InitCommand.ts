/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
import fs, { promises as fsP } from "fs";
import terminalLink from "terminal-link";
import chalk from "chalk";
import hasYarn from "has-yarn";
import execa from "execa";
import mkdirp from "mkdirp";
import yaml from "yaml";
import path from "path";
import editJsonFile from "edit-json-file";
import moment from "moment";
import { Console } from "../console";
import { FailureExit } from "./FailureExit";

const assetsPath = path.resolve(path.join(__dirname, "../../assets"));
const docLink = "https://github.com/log4brains/log4brains";
const cliBinPath = "@log4brains/cli/dist/log4brains";
const webBinPath = "@log4brains/web/dist/bin/log4brains-web";

export type InitCommandOpts = {
  defaults: boolean;
};

type Deps = {
  appConsole: Console;
};

export class InitCommand {
  private readonly console: Console;

  private hasYarnValue?: boolean;

  constructor({ appConsole }: Deps) {
    this.console = appConsole;
  }

  private hasYarn(): boolean {
    if (!this.hasYarnValue) {
      this.hasYarnValue = hasYarn() || this.isDev();
    }
    return this.hasYarnValue;
  }

  private isDev(): boolean {
    return (
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
    );
  }

  private async installNpmPackages(cwd: string): Promise<void> {
    const packages = ["@log4brains/cli", "@log4brains/web"];

    if (this.isDev()) {
      await execa("yarn", ["link", ...packages], { cwd });

      // ... but unfortunately `yarn link` does not create the bin symlinks (https://github.com/yarnpkg/yarn/issues/5713)
      // we have to do it ourselves:
      await mkdirp(path.join(cwd, "node_modules/.bin"));
      await execa(
        "ln",
        ["-s", "--force", `../${cliBinPath}`, "node_modules/.bin/log4brains"],
        { cwd }
      );
      await execa(
        "ln",
        [
          "-s",
          "--force",
          `../${webBinPath}`,
          "node_modules/.bin/log4brains-web"
        ],
        { cwd }
      );
    } else if (this.hasYarn()) {
      await execa(
        "yarn",
        ["add", "--dev", "--ignore-workspace-root-check", ...packages],
        { cwd }
      );
    } else {
      await execa("npm", ["install", "--save-dev", ...packages], { cwd });
    }
  }

  private guessMainAdrFolderPath(cwd: string): string | undefined {
    const usualPaths = [
      "docs/adr",
      "docs/adrs",
      "docs/architecture-decisions",
      "doc/adr",
      "doc/adrs",
      "doc/architecture-decisions",
      "adr",
      "adrs",
      "architecture-decisions"
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const possiblePath of usualPaths) {
      if (fs.existsSync(path.join(cwd, possiblePath))) {
        return possiblePath;
      }
    }
    return undefined;
  }

  private printSuccess(): void {
    const runCmd = this.hasYarn() ? "yarn" : "npm run";
    const l4bCliCmdName = "adr";

    this.console.success("Log4brains is installed and configured! 🎉🎉🎉");
    this.console.print();
    this.console.print("You can now use the CLI to create a new ADR:");
    this.console.print(`  ${chalk.cyan(`${runCmd} ${l4bCliCmdName} new`)}`);
    this.console.print("");
    this.console.print(
      "And start the web UI to preview your architecture knowledge base:"
    );
    this.console.print(`  ${chalk.cyan(`${runCmd} log4brains-preview`)}`);
    this.console.print();
    this.console.print(
      `Do not forget to check the ${terminalLink(
        "documentation",
        docLink
      )} to learn how to set up your CI/CD to publish it`
    );
  }

  private async askPathWhileNotFound(
    question: string,
    cwd: string
  ): Promise<string> {
    const p = await this.console.askInputQuestion(question);
    if (!fs.existsSync(path.join(cwd, p))) {
      this.console.warn("This path does not exist. Please try again...");
      return this.askPathWhileNotFound(question, cwd);
    }
    return p;
  }

  async execute(options: InitCommandOpts, customCwd?: string): Promise<void> {
    const noInteraction = options.defaults;

    const cwd = customCwd ? path.resolve(customCwd) : process.cwd();
    if (!fs.existsSync(cwd)) {
      this.console.fatal(`The given path does not exist: ${chalk.cyan(cwd)}`);
      throw new FailureExit();
    }

    // Check package.json existence
    if (!fs.existsSync(path.join(cwd, "package.json"))) {
      this.console.fatal(`Impossible to find ${chalk.cyan("package.json")}`);
      this.console.print(
        "Are you sure to execute the command inside your project root directory?"
      );
      this.console.print(
        `Please refer to the ${terminalLink(
          "documentation",
          docLink
        )} if you want to use Log4brains in a non-JS project or globally`
      );
      throw new FailureExit();
    }

    // Install NPM packages
    this.console.startSpinner("Installing Log4brains CLI & web packages");
    await this.installNpmPackages(cwd);
    this.console.stopSpinnerSuccess("Log4brains CLI & web packages installed");

    // Set scripts
    const pkgJson = editJsonFile(path.join(cwd, "package.json"));
    pkgJson.set("scripts.adr", "log4brains adr");
    pkgJson.set("scripts.log4brains-preview", "log4brains-web preview");
    pkgJson.set("scripts.log4brains-build", "log4brains-web build");
    pkgJson.save();
    this.console.print(
      `We have added the following scripts to your ${chalk.cyan(
        "package.json"
      )}: adr, log4brains-preview, log4brains-build`
    );
    this.console.print();

    // Terminate now if already configured
    if (fs.existsSync(path.join(cwd, ".log4brains.yml"))) {
      this.console.info(
        `${chalk.cyan(".log4brains.yml")} is already created. We stop there!`
      );
      this.printSuccess();
      return;
    }

    // Create .log4brains.yml interactively
    // Name
    let name;
    try {
      name = require(path.join(cwd, "package.json")).name as string;
      if (!name) {
        throw Error("Empty name");
      }
    } catch (e) {
      this.console.warn(
        `Impossible to get the project name from your ${chalk.cyan(
          "package.json"
        )}`
      );
    }
    name = noInteraction
      ? name || "untitled"
      : await this.console.askInputQuestion(
          "What is the name of your project?",
          name
        );

    // Project type
    const type = noInteraction
      ? "mono"
      : await this.console.askListQuestion(
          "Which statement describes the best your project?",
          [
            {
              name: "Simple project (only one ADR folder)",
              value: "mono",
              short: "Mono-package project"
            },
            {
              name:
                "Multi-packages project (a main ADR folder for global ones + an ADR folder per package for specific ones)",
              value: "multi",
              short: "Multi-package project"
            }
          ]
        );

    // Main ADR folder location
    let adrFolder = this.guessMainAdrFolderPath(cwd);
    if (adrFolder) {
      this.console.info(
        `We have detected a possible existing ADR folder: ${chalk.cyan(
          adrFolder
        )}`
      );
      adrFolder =
        noInteraction ||
        (await this.console.askYesNoQuestion("Do you confirm?", true))
          ? adrFolder
          : undefined;
    }
    if (!adrFolder) {
      adrFolder = noInteraction
        ? "docs/adr"
        : await this.console.askInputQuestion(
            `In which directory do you plan to store your ${
              type === "multi" ? "global " : ""
            }ADRs? (will be automatically created)`,
            "docs/adr"
          );
    }
    await mkdirp(path.join(cwd, adrFolder));
    this.console.print();

    // Packages
    const packages = [];
    if (type === "multi") {
      this.console.print("We will now define your packages...");
      this.console.print();

      let oneMorePackage = false;
      let packageNumber = 1;
      do {
        this.console.print();
        this.console.print(
          `  ${chalk.underline(`Package #${packageNumber}`)}:`
        );
        const pkgName = await this.console.askInputQuestion(
          "Name? (short, lowercase, without special characters, nor spaces)"
        );
        const pkgCodeFolder = await this.askPathWhileNotFound(
          "Where is located the source code of this package?",
          cwd
        );
        const pkgAdrFolder = await this.console.askInputQuestion(
          `In which directory do you plan to store the ADRs of this package? (will be automatically created)`,
          `${pkgCodeFolder}/docs/adr`
        );
        await mkdirp(path.join(cwd, pkgAdrFolder));
        packages.push({
          name: pkgName,
          path: pkgCodeFolder,
          adrFolder: pkgAdrFolder
        });
        oneMorePackage = await this.console.askYesNoQuestion(
          `We are done with package #${packageNumber}. Do you want to add another one?`,
          false
        );
        packageNumber += 1;
      } while (oneMorePackage);
    }

    // Write config
    await fsP.writeFile(
      path.join(cwd, ".log4brains.yml"),
      yaml.stringify({
        project: {
          name,
          adrFolder,
          packages
        }
      }),
      "utf-8"
    );

    // Copy template if not already created
    const templatePath = path.join(cwd, adrFolder, "template.md");
    if (!fs.existsSync(templatePath)) {
      await fsP.copyFile(path.join(assetsPath, "template.md"), templatePath);
    }

    const adrListRes = await execa(
      path.join(cwd, `node_modules/${cliBinPath}`),
      ["adr", "list", "--raw"],
      { cwd }
    );

    // Create Log4brains ADR
    const l4bAdrSlug = (
      await execa(
        path.join(cwd, `node_modules/${cliBinPath}`),
        [
          "adr",
          "new",
          "--quiet",
          "--from",
          path.join(assetsPath, "use-log4brains-to-manage-the-adrs.md"),
          '"Use Log4brains to manage the ADRs"'
        ],
        { cwd }
      )
    ).stdout;
    await execa(
      "sed",
      [
        "-i",
        `s/{DATE}/${moment().format("YYYY-MM-DD")}/g`,
        path.join(cwd, adrFolder, `${l4bAdrSlug}.md`)
      ],
      {
        cwd
      }
    );

    // Create MADR ADR if there was no ADR in the repository
    if (!adrListRes.stdout) {
      const madrAdrSlug = (
        await execa(
          path.join(cwd, `node_modules/${cliBinPath}`),
          [
            "adr",
            "new",
            "--quiet",
            "--from",
            path.join(
              assetsPath,
              "use-markdown-architectural-decision-records.md"
            ),
            '"Use Markdown Architectural Decision Records"'
          ],
          { cwd }
        )
      ).stdout;
      await execa(
        "sed",
        [
          "-i",
          `s/{DATE}/${moment().format("YYYY-MM-DD")}/g`,
          path.join(cwd, adrFolder, `${madrAdrSlug}.md`)
        ],
        {
          cwd
        }
      );
      await execa(
        "sed",
        [
          "-i",
          `s/{LOG4BRAINS_ADR_SLUG}/${l4bAdrSlug}/g`,
          path.join(cwd, adrFolder, `${madrAdrSlug}.md`)
        ],
        {
          cwd
        }
      );
    }

    // End
    this.printSuccess();
  }
}