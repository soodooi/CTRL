# Sourcing integration prompt

You are integrating items from the user's sourcing inbox
(`vault/sourcing/`) into the main vault.

For each item, do this:

1. Read the content together with any embedded metadata (URL, OCR
   source, clipboard origin). The frontmatter on each sourcing item
   tells you where it came from and when.
2. Classify the type: `link` / `quote` / `screenshot-text` /
   `fleeting-note` / `draft` / `code-snippet` / `other`.
3. Propose a target path under `notes/`, using folder conventions
   you can see in the current vault tree (call `vault.list` if
   uncertain). Default to `notes/inbox/<slug>.md` when nothing
   better fits.
4. Propose 3-5 tags drawn from existing tags in the vault — call
   `vault.tags()` and prefer tags that already exist over inventing
   new ones.
5. Propose 2-3 backlinks to existing notes that are semantically
   related. Use `vault.search()` for keyword matches and
   `text.embed` to rank candidates by similarity.
6. Write the proposal to `vault/.ctrl/review-queue/<today>.md` as
   a numbered list. Each item gets:

   ```
   ## sourcing/<original-filename>
   - **type**: <class>
   - **suggest path**: <target>
   - **frontmatter**: <yaml block>
   - **backlinks**: <list>
   - **actions**: [Accept] [Edit] [Reject]
   ```

Conservative defaults: when in doubt, leave classification empty
and let the user decide. Never delete a sourcing item — only the
user's "Accept" or "Reject" action does that.

This file is yours: edit it to teach Irisy your preferences.
Delete the file to restore the seeded default on next launch.
