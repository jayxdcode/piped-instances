# piped-instances
Automatic Piped API instance parser

---


This repository automaticaly generates a fresh JSON of all available Piped API instances based on TeamPiped's instance list.

The parser used here is also based on their sample dynamic parser. (Although the output structure here is different)


## How to access?

Just fetch the following URL of your choice (details below at [What to use?](#what-to-use)):

* Full (Verbose version):
```
https://github.com/jayxdcode/piped-instances/public/full.json
```

* Lite 
```
https://github.com/jayxdcode/piped-instances/public/lite.json
```

* Minimal
```
https://github.com/jayxdcode/piped-instances/public/minimal.json
```


## Shape

The `full.json` file has this shape:

```
{
  "generated_at": "2026-04-17T13:28:24.753Z",
  "source": "https://github.com/TeamPiped/documentation/...",
  "version_priority": "2026.0.0",
  "instances": [
    {
      "name": "private.coffee",
      "api_url": "https://api.piped.private.coffee",
      "countryFlag": ">emoji<",
      "countryISO": "PH",
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
> In the actual JSON, "metrics" has 8 keys. It might seem small here but even small things matter in terms of saving bandwidth.


## What to use?

The script now outputs 3 files (unlike the previous verbose only output):

- `public/`
  - `full.json`
  - `lite.json`
  - `minimal.json`



* `full.json` contains all the data.
  - If you want verbosity, use it.

* `lite.json` has the "whitespace" part ommited (test result visualization for each instance).
  - Recommended if the purpose is for creating insights per instance available.

* `minimal.json` is the bare bones version. It is basically `lite.json` but without the metrics part.
  - Recommended if you only need the API URLs and other metadata.



---

This repo's workflow and it's correspondung script were extracted from one of my other repos in the purpose of having a separate place for the Actions' commits that stacked up on the main repository.

If you want to check it out, here it is: [jayxdcode/dcma](https://github.com/jayxdcode/dcma)
