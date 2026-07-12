export function pipelineErrorMessage(
  rawError: string,
  lang: "it" | "en",
): string {
  if (rawError.includes("no_games_found_for_goal_time_class")) {
    return lang === "en"
      ? "I could not find games in the rapid or blitz time control you selected. Check the Chess.com username and the chosen time control, then try again."
      : "Non ho trovato partite nella cadenza rapid o blitz che hai scelto. Controlla username Chess.com e cadenza, poi riprova.";
  }
  if (rawError.includes("archive_fetch_failed_all")) {
    return lang === "en"
      ? "Chess.com did not return your game archives. Your profile was not created from empty data: try again in a moment."
      : "Chess.com non ha restituito gli archivi delle tue partite. Non ho creato un profilo vuoto: riprova tra poco.";
  }
  if (
    rawError.includes("games_index_failed_for_goal_time_class") ||
    rawError.includes("no_analyzable_games")
  ) {
    return lang === "en"
      ? "I found your games, but could not complete a reliable first analysis. Nothing empty was published; try again."
      : "Ho trovato le tue partite, ma non sono riuscito a completare una prima analisi affidabile. Non ho pubblicato un profilo vuoto: riprova.";
  }
  if (rawError.includes("background_analysis_incomplete")) {
    return lang === "en"
      ? "The profile uses only the successful analyses; some selected games could not be read. You can retry them manually without losing the available data."
      : "Il profilo usa solo le analisi riuscite; alcune partite selezionate non sono state lette. Puoi ritentarle manualmente senza perdere i dati disponibili.";
  }
  return lang === "en"
    ? "I could not complete the analysis. Your partial data was kept safely; try again."
    : "Non sono riuscito a completare l'analisi. I dati gia' elaborati sono al sicuro: riprova.";
}
