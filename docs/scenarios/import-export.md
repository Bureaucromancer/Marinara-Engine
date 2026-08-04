# Scenario import and export

Scenarios move in and out of Marinara in two formats. Both are plain JSON.

## Marinara Native (`.marinara.json`)

The full-fidelity format. It keeps everything: the structured setting, the protagonist object, cast character links, genre and content rating, and any AI attribution recorded against individual fields.

Use this for backups and for moving scenarios between Marinara installs.

## Compatible JSON (`.json`)

A flatter shape that matches the scenario files other roleplay tools read. The setting collapses to a single text field and the protagonist to a bare name, because that is all the other format can express.

Nothing is thrown away: everything without a home in the flat shape is preserved inside the file's own metadata, so a compatible file exported from Marinara and imported back into Marinara is lossless.

**A caveat worth knowing.** The tool this format matches can *write* these files but cannot currently *read* them. So in practice compatible files flow **into** Marinara. Exporting one is still useful — it is a documented, readable format, and it round-trips back here — but do not expect to hand it to that tool and have it open.

## Importing

Drop files onto the import dialog, or click to browse. Several at once is fine. Each file is inspected and routed automatically; you do not have to say which format it is. Anything that is not a scenario is reported per file rather than half-imported.

### Links may not survive the trip

A scenario refers to lorebooks and character cards by id. Those ids mean nothing on a different install, and nothing is bundled into the export.

On import, each link is matched first by id, then by exact name. Anything still unmatched is **dropped and reported** in the import results. A missing link never fails an import — you get the scenario, minus the references that could not be found.

Practically: if you are sending a scenario to someone else and it depends on a lorebook, send the lorebook too and have them import it first. The export dialog warns you when a scenario has links.

### Exporting several at once

Select scenarios in the panel and export the selection to get a zip, one file per scenario, in the native format.

## AI attribution

Where a field is recorded as AI-generated, that record travels with the scenario and survives both formats. You can clear it from the scenario editor; clearing changes no field values, only the record of where they came from.
