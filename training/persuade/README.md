# PERSUADE span classifier workspace

Isolated Python workspace for training and evaluating an argument-span classifier on PERSUADE 2.0 (CC BY-NC-SA 4.0).
Nothing here is imported by the Next.js app. **Start with [HANDOFF.md](HANDOFF.md)**: it has the full status, decisions,
measured facts and the step-by-step plan. [ARCHITECTURE.md](ARCHITECTURE.md) is the Phase 0 proposal.

```
python3 -I -m unittest discover -s . -t .      # preprocessing tests (standard library only)
```

Data and artifacts live outside the repo (`~/galti-pakar-data/persuade/`) or in gitignored folders. Never commit data, checkpoints or secrets.
