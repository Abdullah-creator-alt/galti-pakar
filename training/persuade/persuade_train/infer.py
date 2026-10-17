import sys, json, os

def main():
    # Read JSON payload from stdin
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # Expected keys: text, sentences (list of {id, start, end})
    # Placeholder: return empty spans and candidates
    output = {
        "name": "placeholder_classifier",
        "spans": [],
        "candidates": []
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
