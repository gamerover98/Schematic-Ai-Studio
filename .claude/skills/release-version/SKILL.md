---
name: release-version
description: Decide and apply the version bump in package.json before a release, then prepare and open the two pull requests that carry it to master, with gh. Use when preparing a merge into master, when the Version check on a pull request is red, when a master build failed because its tag already exists, when asked which of patch, minor and major this release should be, or when asked to open the pull request for a release.
---

# Bumping the version

Everything about a release here is automatic except one number.
`.github/workflows/build.yml` decides what the build is called, packages it for
Windows and Linux, creates the tag against the commit it actually built, and
publishes the release with notes generated from the **titles of the pull
requests** merged since the last tag. The one thing it does not do is choose
the number, and that is deliberate: for an app somebody downloads, **the
version is a statement to a person rather than a function of the commit log**,
which is the argument `CLAUDE.md` uses to reject `semantic-release` and which
has not moved.

So this skill's job is not to automate the decision. It is to put the evidence
in front of whoever makes it, then carry out the one command without the two
mistakes that command invites — and then to open the pull requests that take
the number to `master`, one confirmed step at a time.

## The shape of it

```
package.json                       the number, and the only copy of it
.github/workflows/version.yml      the gate: red on a PR into master if the tag exists
.github/workflows/build.yml        the same question again, at publish time
```

**There is no second place to update.** `app.getVersion()` reads
`package.json` at runtime and the About box receives it over IPC, so the number
on screen cannot drift from the number in the manifest. There is no
`CHANGELOG.md` and there must not be — the notes come from `gh release create
--generate-notes`, and a hand-written changelog is a second copy that goes
stale.

## The rule that makes it trustworthy

**Propose, with the commits behind it, and then ask.**

A skill that picks the digit silently is `semantic-release` under another name,
and the reason that was rejected is the reason this stops short of it. The
classification below is a strong default and it is not an authority: a fix that
changes what a saved file looks like is a bigger release than a `feat` that
adds a menu item, and only a person can say so.

The same rule reaches the pull requests: **each one is shown, title and body,
and opened only after an explicit yes.** Opening a PR is public.

## Doing it

1. **Find the last stable release.**

   ```bash
   git tag --list 'v*' --sort=-v:refname | grep -v -- '-dev\.' | head -1
   ```

   **The `grep` is load-bearing and is the trap in this file.** `develop`
   publishes prereleases named `<version>-dev.<run_number>`, and git's version
   sort puts `v1.0.0-dev.5` *above* `v1.0.0` unless `versionsort.suffix` is
   configured — the opposite of what semver says. Drop the filter and the
   "last release" is a dev build of the release you are standing on.

2. **Read the commits since it**, subjects and bodies both:

   ```bash
   git log --format='%s%n%b%n--' "$last..HEAD"
   ```

3. **Classify, by the conventional prefixes this repo already uses:**

   | evidence | proposal |
   |---|---|
   | `BREAKING CHANGE:` in a body, or `!` before the colon | **major** |
   | at least one `feat` | **minor** |
   | anything else — `fix`, `perf`, `ci`, `docs`, `refactor` | **patch** |

   A schematic that this release writes differently, or a settings field an
   older build cannot read, is a breaking change whatever the prefix says.
   Say so if you see one.

4. **Show the user the proposal and the commits that produced it**, then ask.
   Not "shall I bump" — *this digit, because of these commits*.

5. **Check the tag is free**, which is the gate's question asked locally:

   ```bash
   git rev-parse -q --verify "refs/tags/v$new" >/dev/null && echo "already released"
   ```

   A bump that the CI will then refuse is worse than no bump: it is the same
   red build one step further along.

6. **Apply it.**

   ```bash
   npm version --no-git-tag-version "$new"
   ```

   **The flag is not optional.** Bare `npm version` creates a commit *and a
   tag*, and the tag here belongs to the publish job, which pins it to the
   commit that was actually built with `--target $GITHUB_SHA`. A local tag is a
   second authority over one name, and the one that reaches GitHub first wins.

   `package-lock.json` is updated by the same command and belongs in the same
   commit.

7. **Say the two things the CI cannot.** The release notes are
   `--generate-notes` over the **pull request titles** merged since the
   previous tag — not the commit subjects: `v1.0.0`'s notes are one line per
   PR, #1 to #3, with not one subject among them. So the titles written in
   step 9 are the release notes word for word, and this is the last moment to
   get them right. And the bump has to be on the branch that will be merged
   into `master` — on `develop` alone it changes only what the next
   `-dev.<n>` prerelease is called.

8. **Commit only when asked**, as everywhere in this repo, and never push.

9. **Open the pull requests.** Only once the bump is committed; if it is not,
   stop and say so. The guide around these steps is written in the language of
   the conversation; every title and body is in **English**.

   **Check first, all read-only:**

   ```bash
   gh auth status
   git fetch origin
   branch=$(git rev-parse --abbrev-ref HEAD)
   [ "$(git rev-parse "origin/$branch" 2>/dev/null)" = "$(git rev-parse HEAD)" ] || echo "not pushed"
   git cherry origin/develop HEAD            # a '-' line is a duplicate
   gh pr list --head "$branch" --base develop --state open --json number,url
   ```

   - **The remote branch must equal `HEAD`**, or stop. The push is the
     user's: give them `git push -u origin <branch>`, or
     `git push --force-with-lease origin <branch>` when the remote is not an
     ancestor of `HEAD` — which is what a rebase leaves behind.
   - **A `-` line from `git cherry` is a commit `develop` already has under
     another SHA.** Recommend `git rebase origin/develop` before opening
     anything; the PR would otherwise carry every one of them again.
   - **An open PR for the same head and base already exists?** Show it and
     open nothing.

   **The body is the list of changes and nothing else.** Built from the same
   range as step 2, grouped by prefix, oldest first, prefix stripped, release
   bumps left out:

   ```bash
   body="<scratchpad>/pr-body.md"
   list() { git log --reverse --format='%s' "$last..HEAD" | grep -Ev '^chore\(release\)'; }
   strip() { sed -E 's/^[a-z]+(\([^)]*\))?!?: //; s/^/- /'; }
   {
     f=$(list | grep -E '^feat(\(|!|:)' | strip)
     x=$(list | grep -E '^fix(\(|!|:)' | strip)
     o=$(list | grep -Ev '^(feat|fix)(\(|!|:)' | strip)
     [ -n "$f" ] && printf '### Features\n\n%s\n\n' "$f"
     [ -n "$x" ] && printf '### Fixes\n\n%s\n\n' "$x"
     [ -n "$o" ] && printf '### Other\n\n%s\n' "$o"
   } > "$body"
   ```

   `--reverse` is what makes it read in the order the work happened. The
   `chore(release)` filter is what keeps a bump that never shipped — `1.0.1`
   under a `1.1.0` release — out of a list somebody reads as history. An empty
   section is omitted rather than printed as a heading with nothing under it.

   **No introduction, no verification section, no footer, no emoji** — the
   standard "Generated with Claude Code" line included, because the user asked
   for the list alone. Check the file rather than trusting the subjects:

   ```bash
   python -c "import sys,unicodedata; t=open(sys.argv[1],encoding='utf-8').read(); print(sum(unicodedata.category(c)=='So' for c in t))" "$body"
   ```

   `grep -P` with a range of high code points fails outright here rather than
   answering, which is why this is Python.

   **The title stands on its own**, in English and without emoji, because it
   is the line the release notes will carry. The first PR's is a sentence
   summing up the list, in the style of #1, #2 and #4 ("Twelve rendering
   faults, a version gate, and 1.0.1"); the second's is
   `Release <version>: <summary>`.

   **PR 1 — the feature branch into `develop`.** Show the title and the body
   in the chat, ask, and only on a yes:

   ```bash
   gh pr create --base develop --head "$branch" --title "$title" --body-file "$body"
   ```

   **`--head` is always explicit, and the remote check above always runs
   first.** Without `--head`, `gh` pushes a branch it cannot find on the
   remote — its own help says `--dry-run` *"may still push git changes"* — and
   pushing is the one thing this skill must not do. `gh pr create --dry-run`
   with the same arguments is the safe way to see what would be sent.

   **PR 2 — `develop` into `master`.** Only once PR 1 is merged and
   `develop` carries the new number, read from the file rather than by commit,
   because a rebase-merge gives the bump a different SHA:

   ```bash
   git fetch origin
   git show origin/develop:package.json | python -c "import sys,json; print(json.load(sys.stdin)['version'])"
   ```

   If it is not the new number yet, say so and stop: `/release-version` is run
   again after the merge. Otherwise the same three checks, the same show-and-ask,
   and `gh pr create --base master --head develop ...`. Then
   `gh pr checks <n>`: the `Version` job is the gate from `version.yml` and has
   to be green.

   **Merging is the user's**, and the guide says how and why:

   ```bash
   gh pr merge <n> --merge
   ```

   A **merge commit**, on both. #4 was rebase-merged, which gave `develop`
   thirteen commits under new SHAs that the feature branch still carried, and
   it took a rebase to clear them; #3 took `develop` into `master` as a merge
   commit, and that is the release `v1.0.0` points at. After the merge into
   `develop` the CI publishes a `-dev.<n>` prerelease; after the merge into
   `master` it tags `v<version>` and publishes the release.

## What this must not do

Written down because each is what somebody would add:

- **no tag**, for the reason in step 6;
- **no push**, and no `gh release create` — publishing is the workflow's, and
  it is the only thing holding a token. A branch that is not on the remote
  stops step 9; it is not pushed to make step 9 work;
- **no pull request without a yes**, one yes per pull request. The first
  being approved does not approve the second;
- **no merge.** `gh pr merge` is the step that publishes a release, and it is
  the user's;
- **no second pull request for the same head and base**; show the open one;
- **nothing under `.github/`.** If the gate is wrong, that is a change to make
  deliberately and not a step in a bump;
- **no `CHANGELOG.md`**, for the reason in *The shape of it*;
- **no bump on `master` itself.** That is the state this exists to avoid: a
  commit pushed straight onto a protected branch to rescue a red release build.

## Notes worth having

- **`develop` never commits a version.** Its number is `package.json`'s plus
  `-dev.<run_number>`, applied on the runner by `npm version
  --allow-same-version` and never written back. That single decision is what
  removes the bot commit, the `[skip ci]` loop and the `package.json` conflict
  between the two branches, so a bump on `develop` is a bump *for the next
  release*, not for the dev builds.
- **Forgetting is caught twice.** `version.yml` turns the pull request into
  `master` red, and `build.yml` refuses again at publish time for everything
  that does not arrive through a pull request. Both depend on `fetch-depth: 0`:
  shallow, there are no tags to read and either guard passes in silence.
- **`BUILD_NUMBER` is not this number.** electron-builder folds it into the
  Windows file version as `major.minor.patch.<n>`; it is set on `develop` and
  deliberately empty on `master`, where `x.y.z.0` is the deterministic answer.
  Nothing here touches it.
- **The repository allows all three merge methods** (`gh repo view --json
  mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed`), so `--merge` is
  never refused; recommending it is a choice, not a constraint.
