The project_name: memory-tool-impl

1. Create a DEV folder:
Check out https://github.com/symunona/obsidian-hermes.git repo into ~/dev/tmp/agents/obsidian-hermes-[project_name]

2. See if the plan makes sense to you

3. answer all of these questions:
- are there any architectural changes this needs?
- are there anything that's not clear from the project description, that should be clarified?
- how will I organize these changes into atomic commits?

4. branch off from development branch, create a new branch called agent/[project_name] set remote to origin

5. Implement plan/[project_name].md plan in the DEV folder.
If you'd need to edit a lot of EXISTING files, ask yourself: is this an architectural change?
If so, ask for approval.
Use atomic commits where possible!

6. When done, push to GitHub

7. Create a PR back to the development branch when done

8. List all the more complicated questions that came up during the process. Show a short summary of what happened!

9. open windsurf in that folder. After this point, do not auto-commit or auto-push, do not auto build (assume the dev is doing all those)