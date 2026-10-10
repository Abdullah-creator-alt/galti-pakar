"""Label sets and the PERSUADE -> Galti Pakar role mapping. The model is trained on PERSUADE-native labels;
mapping to Galti roles is a separate, explicit step so definitions are never silently equated."""

# Order is the class index order; do not reorder without retraining.
PERSUADE_LABELS = ["Lead", "Position", "Claim", "Counterclaim", "Rebuttal", "Evidence", "Concluding Statement"]
UNANNOTATED = "Unannotated"

BIO_TAGS = ["O"] + [f"{p}-{l}" for l in PERSUADE_LABELS for p in ("B", "I")]
TAG_TO_ID = {t: i for i, t in enumerate(BIO_TAGS)}

# Galti Pakar roles (lib/structure/types.ts ARGUMENT_ROLES). None = no equivalent, treat as unlabelled.
GALTI_ROLE = {
    "Position": "thesis",
    "Claim": "claim",
    "Counterclaim": "counterclaim",
    "Rebuttal": "rebuttal",
    "Concluding Statement": "conclusion",
    "Evidence": "evidence",  # partial match: see MAPPING_NOTES
    "Lead": None,
}

# How well each mapping fits. "partial" means the definitions differ and results must be read with care.
MAPPING_FIT = {
    "Position": "good",
    "Claim": "good",
    "Counterclaim": "good",
    "Rebuttal": "good",
    "Concluding Statement": "good",
    "Evidence": "partial",
    "Lead": "none",
}

MAPPING_NOTES = {
    "Evidence": (
        "PERSUADE evidence is any idea or example supporting a claim; much of it is general reasoning. Galti Pakar separates "
        "concrete 'evidence' from 'premise'. The classifier cannot output 'premise'; compare against Gemini's evidence+premise merged."
    ),
    "Lead": "An attention-getting opener has no Galti role; it maps to unlabelled.",
}

# Galti roles that have no PERSUADE counterpart and are never produced by the classifier.
GALTI_ROLES_WITHOUT_SOURCE = ["premise", "other"]
