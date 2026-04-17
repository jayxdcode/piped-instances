# piped-instances
Automatic Piped API instance parser

---


This repository automaticaly generates a fresh JSON of all available Piped API instances based on TeamPiped's instance list.

The parser used here is also based on their sample dynamic parser. (Although the output structure here is different)


## How to access?

Just fetch the following URL:
```
https://github.com/jayxdcode/piped-instances/public.json
```

## What to expect?

The `public.json` file has this shape:

```
{
  "generated_at": "2026-04-17T13:28:24.753Z",
  "source": "https://github.com/TeamPiped/documentation/...",
  "version_priority": "2026.0.0",
  "instances": [
    {
      "name": "https://api.piped.private.coffee",
      "api_url": "https://api.piped.private.coffee",
      "cdn": "No",

      

      "metrics": {
        "suggestion_success_rate": 1,
        "search_success_rate": 1,
        "combined_latency_ms": 879
      },
      "version": "2026.0.0",
      "isLatest": true
    }
  ]
}
```

> Notice the big whitespace between "cdn" and "metrics"? That place is supposed to be where the detailed summary of the tests made on that specific instance


This workflow and it's correspondung script was extracted from one of my other repos in the purpose of having a separate place for the Actions' commits that stacked up on the main repository.

If you want to check it out, here it is: [jayxdcode/dcma](https://github.com/jayxdcode/dcma)
