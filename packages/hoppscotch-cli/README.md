# Hoppscotch CLI <font size=2><sup>ALPHA</sup></font>

A CLI to run Hoppscotch Test Scripts in CI environments.

### **Commands:**

- `hopp test [options] [file]`: run a Hoppscotch collection export or workspace collection by id
- `hopp init`: interactively initialize local CLI config
- `hopp config init`: same interactive config flow under the config group
- `hopp gen-skill`: generate the Hoppscotch CLI skill files under the current working directory's `.claude/hoppscotch-cli/` and `.codex/hoppscotch-cli/`

### **Usage:**

```bash
hopp [options or commands] arguments
```

### **Options:**

- `-v`, `--ver`: see the current version of the CLI
- `-h`, `--help`: display help for command

## **Command Descriptions:**

1.  #### **`hopp -v` / `hopp --ver`**

    - Prints out the current version of the Hoppscotch CLI

2.  #### **`hopp -h` / `hopp --help`**

    - Displays the help text

3.  #### **`hopp test [options] <file_path_or_id>`**

    - Runs one or more saved requests from a Hoppscotch collection export file or a workspace collection id.
    - If you pass request targets with `--request`, only those requests are executed.
    - If a request has a saved body, that body is used as-is.
    - If a request body is missing, Hoppscotch CLI uses the request's saved/default body shape, not any browser-only UI state.
    - Executes pre-request scripts, the HTTP request, and test scripts in order.
    - Outputs the request response and test results.

    #### Options:

    ##### `-e, --env <file_path_or_id> `

    - Accepts path to env.json with contents in below format:

      ```json
      {
        "ENV1": "value1",
        "ENV2": "value2"
      }
      ```

    - You can now access those variables using `pw.env.get('<var_name>')`

      Taking the above example, `pw.env.get("ENV1")` will return `"value1"`

    #### `-d, --delay <delay_in_ms>`

    - Used to defer the execution of requests in a collection.

    #### `--token <access_token>`

    - Expects a personal access token to be passed for establishing connection with your Hoppscotch account.

    #### `--server <server_url>`

    - URL of your self-hosted instance, if your collections are on a self-hosted instance.

    #### `--reporter-junit [path]`

    - Expects a file path to store the JUnit Report.

    ##### `--iteration-count <no_of_iterations>`

    - Accepts the number of iterations to run the collection

    ##### `--iteration-data <file_path>`

    - Accepts the path to a CSV file with contents in the below format:

      ```text
      key1,key2,key3
      value1,value2,value3
      value4,value5,value6
      ```

    - For every iteration, the values will be merged into the environment for that run.
    - Values from `--iteration-data` override environment variables with the same key.
    - Use `--iteration-count` if you want more iterations than rows in the CSV.

    ##### `--request-map <file_path_or_json>`

    - Accepts either:
      - a JSON array passed inline on the command line, or
      - a path to a JSON file containing the same array
    - Use it to temporarily override request bodies by request name during a `hopp test` run.
    - If you do not pass `--request`, the CLI runs the requests named in the map.
    - If you pass both `--request` and `--request-map`, the CLI runs the union of both target sets.
    - Each entry must contain:
      - `request_name`: exact saved request name to match
      - `request_body`: the body to inject for that request
    - If `request_body` is a JSON object or array, the CLI serializes it to JSON before sending the request.
    - If `request_body` is a string, the CLI sends it as-is.

    - Inline JSON example:

      ```bash
      hopp test ./collection.json \
        --request login \
        --request search-user \
        --request-map '[{"request_name":"login","request_body":{"username":"alice","password":"secret"}},{"request_name":"search-user","request_body":{"query":"hoppscotch"}}]'
      ```

    - File example:

      ```json
      [
        {
          "request_name": "login",
          "request_body": {
            "username": "alice",
            "password": "secret"
          }
        },
        {
          "request_name": "search-user",
          "request_body": {
            "query": "hoppscotch"
          }
        }
      ]
      ```

    - The CLI matches each `request_name` against the saved request name and temporarily overrides that request's body for the test run.

    #### `--legacy-sandbox`

    - Opt out from the experimental scripting sandbox.

4.  #### **`hopp init` / `hopp config init`**

    - Prompts for local CLI config keys one by one.
    - Press `Enter` to keep the current value for a key.
    - Intended for first-time setup or re-checking local CLI defaults.
    - Supported keys:
      - `server`
      - `token`
      - `refreshToken`
      - `teamId`
      - `workspaceId`
    - Example flow:

      ```text
      Server URL [https://api.hoppscotch.io/graphql]:
      Access token [set]:
      Refresh token [set]:
      Team ID [team-123]:
      Workspace ID:
      ```

    - After the prompts finish, the CLI writes the result to the local config file and prints the stored values in a masked form.

5.  #### **`hopp gen-skill`**

    - Generates the Hoppscotch CLI skill for AI agents.
    - Writes the same `SKILL.md` content to two agent-specific locations under the current working directory:
      - `./.claude/hoppscotch-cli/SKILL.md`
      - `./.codex/hoppscotch-cli/SKILL.md`
    - The generated skill is meant to guide agents that need to create, manage, or test APIs with Hoppscotch.
    - The skill description explicitly tells agents to use it whenever the task is about API creation, API management, or API testing.
    - The generated skill explains how to use this CLI to:
      - initialize config
      - list and manage collections
      - create, list, update, delete, and run requests
      - manage environments
      - run tests with `--request-map` and `--iteration-data`
    - Use `--print` if you want to inspect the final skill markdown without writing files.
    - Use `--force` when you want to overwrite existing skill files.
    - Example:

      ```bash
      hopp gen-skill
      ```

    - Example print-only flow:

      ```bash
      hopp gen-skill --print > SKILL.md
      ```

    - Example generated file locations:

      ```text
      ./.claude/hoppscotch-cli/SKILL.md
      ./.codex/hoppscotch-cli/SKILL.md
      ```

## Versioning

The Hoppscotch CLI follows **pre-1.0 semantic versioning** conventions while in alpha (version `< 1.0.0`):

- **Feature releases** (e.g., `0.20.0` → `0.21.0`): New features, enhancements, or improvements
- **Patch releases** (e.g., `0.20.0` → `0.20.1`): Bug fixes, security patches, and minor improvements
- **Breaking changes** (e.g., `0.21.0` → `0.30.0`): Major version-like bumps for backwards-incompatible changes

> Once the CLI reaches stability and a mature feature set, we will transition to standard semantic versioning starting with `1.0.0`.

## Install from source

- This CLI is maintained in the Hoppscotch repository. It is not a standalone official installer flow, so the recommended way to use it is from source in this repo.
- Before you build or link the CLI, make sure you have the dependencies it requires to run.

  - **Windows & macOS**: You will need `node-gyp` installed. Find instructions here: https://github.com/nodejs/node-gyp
  - **Debian/Ubuntu derivatives**:
    ```sh
    sudo apt-get install python g++ build-essential
    ```
  - **Alpine Linux**:
    ```sh
    sudo apk add python3 make g++
    ```
  - **Amazon Linux (AMI)**
    ```sh
    sudo yum install gcc72 gcc72-c++
    ```
  - **Arch Linux**
    ```sh
    sudo pacman -S make gcc python
    ```
  - **RHEL/Fedora derivatives**:
    ```sh
    sudo dnf install python3 make gcc gcc-c++ zlib-devel brotli-devel openssl-devel libuv-devel
    ```

- To install the CLI locally from this repository:
  ```sh
  git clone <repo-url>
  cd hoppscotch
  pnpm install
  cd packages/hoppscotch-cli
  pnpm run build
  sudo pnpm link --global
  ```
- After linking, run `hopp --help` or `hopp test ...` from any shell.
- If you do not want to link globally, you can run the binary directly from the repo:
  ```sh
  node packages/hoppscotch-cli/bin/hopp.js --help
  ```

## **Developing:**

1. Clone the repository, make sure you've installed latest [pnpm](https://pnpm.io).
2. `pnpm install`
3. Build required workspace dependencies (if needed):
   ```bash
   # These auto-build via postinstall hooks during 'pnpm install'
   # Rebuild manually only when you make changes to these packages:
   pnpm --filter @hoppscotch/data run build
   pnpm --filter @hoppscotch/js-sandbox run build
   ```
4. `cd packages/hoppscotch-cli`
5. `pnpm run build`
6. `sudo pnpm link --global`
7. Test the installation by executing `hopp`

## **Contributing:**

When contributing to this repository, please first discuss the change you wish to make via issue,
email, or any other method with the owners of this repository before making a change.

Please note we have a code of conduct, please follow it in all your interactions with the project.

## Pull Request Process

1. Ensure any install or build dependencies are removed before the end of the layer when doing a
   build.
2. Update the README.md with details of changes to the interface, this includes new environment
   variables, exposed ports, useful file locations and container parameters.
3. Increase the version numbers in any examples files and the README.md to the new version that this
   Pull Request would represent. The versioning scheme we use is [SemVer](https://semver.org).
4. You may merge the Pull Request once you have the sign-off of two other developers, or if you
   do not have permission to do that, you may request the second reviewer merge it for you.

## Set Up The Development Environment

1. After cloning the repository, execute the following commands:

   ```bash
   pnpm install
   # Build required workspace dependencies (if needed)
   # These auto-build via postinstall hooks during 'pnpm install'
   # Rebuild manually only when you make changes to these packages:
   pnpm --filter @hoppscotch/data run build
   pnpm --filter @hoppscotch/js-sandbox run build
   # Then build the CLI
   cd packages/hoppscotch-cli && pnpm run build
   ```

2. In order to test locally, you can use two types of package linking:

   1. The 'pnpm exec' way (preferred since it does not hamper your original installation of the CLI):

      ```bash
      pnpm link @hoppscotch/cli

      // Then to use or test the CLI:
      pnpm exec hopp

      // After testing, to remove the package linking:
      pnpm rm @hoppscotch/cli
      ```

   2. The 'global' way (warning: this might override the globally installed CLI, if exists):

      ```bash
      sudo pnpm link --global

      // Then to use or test the CLI:
      hopp

      // After testing, to remove the package linking:
      sudo pnpm rm --global @hoppscotch/cli
      ```

3. To use the Typescript watch scripts:

   ```bash
   pnpm run dev
   ```
