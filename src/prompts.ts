export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>,
  ) => Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
}

const analyzeArea: PromptDefinition = {
  name: "analyze-area",
  description:
    "Generate a comprehensive analysis of a geographic area covering demographics, housing costs, mortgage lending, employment, and migration patterns.",
  arguments: [
    {
      name: "area_type",
      description:
        "Geographic area type: zip, county, state, cbsa, tract, or place",
      required: true,
    },
    {
      name: "area_code",
      description:
        "Area identifier: 5-digit ZIP, FIPS code, GEOID, or CBSA code",
      required: true,
    },
  ],
  getMessages: (args) => [
    {
      role: "user",
      content: {
        type: "text",
        text: [
          `Provide a comprehensive analysis of the geographic area: ${args.area_type} ${args.area_code}.`,
          "",
          "Please cover:",
          "1. **Demographics** — population, income levels, education, housing stock, and household composition",
          "2. **Housing costs** — Fair Market Rent rates by bedroom count (if available for this area type)",
          "3. **Mortgage lending** — origination volume, denial rates, median loan amounts, and loan type mix (if available)",
          "4. **Employment** — total jobs, top industries, earnings distribution, and commute patterns (if available)",
          "5. **Migration** — net migration trends, top inflow/outflow areas (if available for county/state)",
          "",
          "Use the available tools to gather data, then synthesize the findings into a clear narrative with key takeaways.",
        ].join("\n"),
      },
    },
  ],
};

const compareAreas: PromptDefinition = {
  name: "compare-areas",
  description:
    "Compare two or more geographic areas across demographics, housing, and economic indicators.",
  arguments: [
    {
      name: "areas",
      description:
        "Comma-separated list of area identifiers to compare (e.g., '30301,30302,30303' for ZIP codes, or '13121,13089' for counties)",
      required: true,
    },
    {
      name: "area_type",
      description:
        "Geographic area type shared by all areas: zip, county, state, tract",
      required: true,
    },
  ],
  getMessages: (args) => {
    const areas = args.areas.split(",").map((a) => a.trim());
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Compare the following ${args.area_type} areas side by side: ${areas.join(", ")}.`,
            "",
            "Please compare:",
            "1. **Demographics** — population size, median income, education levels, and age distribution",
            "2. **Housing** — Fair Market Rent rates and housing costs (if applicable)",
            "3. **Employment** — job counts, top industries, and earnings (if applicable)",
            "4. **Mortgage lending** — origination volume, denial rates, and median loan amounts (if applicable)",
            "",
            "Present the comparison in a structured format and highlight the most notable differences between the areas.",
          ].join("\n"),
        },
      },
    ];
  },
};

const marketAnalysis: PromptDefinition = {
  name: "market-analysis",
  description:
    "Analyze the real estate market for a geographic area using housing costs, mortgage trends, demographics, and migration data.",
  arguments: [
    {
      name: "area_type",
      description: "Geographic area type: zip, county, state, or cbsa",
      required: true,
    },
    {
      name: "area_code",
      description: "Area identifier: ZIP code, FIPS code, or CBSA code",
      required: true,
    },
  ],
  getMessages: (args) => [
    {
      role: "user",
      content: {
        type: "text",
        text: [
          `Provide a real estate market analysis for ${args.area_type} ${args.area_code}.`,
          "",
          "Please analyze:",
          "1. **Housing costs** — current Fair Market Rent rates and historical trends",
          "2. **Mortgage activity** — lending volume, denial rates, interest rates, and loan type mix over time",
          "3. **Demand indicators** — population trends, income growth, and net migration patterns",
          "4. **Employment base** — job market size, industry diversification, and commute patterns",
          "",
          "Synthesize the data into an assessment of market conditions, affordability, and outlook.",
        ].join("\n"),
      },
    },
  ],
};

export const allPrompts: PromptDefinition[] = [
  analyzeArea,
  compareAreas,
  marketAnalysis,
];
