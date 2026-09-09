---
name: release-version
description: Decide and apply the version bump in package.json before a release. Use when preparing a merge into master, when the Version check on a pull request is red, when a master build failed because its tag already exists, or when asked which of patch, minor and major this release should be.
---

# Bumping the version

Everything about a release here is automatic except one number.
`.github/workflows/build.yml` decides what the build is called, packages it for
Windows and Linux, creates the tag against the commit it actually built, and
publishes the release with notes generated from the commit subjects. The one
thing it does not do is choose the number, and that is deliberate: for an app
somebody downloads, **the version is a statement to a person rather than a
function of the commit log**, which is the argument `CLAUDE.md` uses to reject
`semantic-release` and which has not moved.

So this skill's job is not to automate the decision. It is to put the evidence
in front of whoever makes it, then carry out the one command without the two
mistakes that command invites.

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
   `--generate-notes` over the commit *subjects*, so a badly written subject is
   a badly written release note and this is the last moment to notice. And the
   bump has to be on the branch that will be merged into `master` — on
   `develop` alone it changes only what the next `-dev.<n>` prerelease is
   called.

8. **Commit only when asked**, as everywhere in this repo, and never push.

## What this must not do

Written down because each is what somebody would add:

- **no tag**, for the reason in step 6;
- **no push**, and no `gh release create` — publishing is the workflow's, and
  it is the only thing holding a token;
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
