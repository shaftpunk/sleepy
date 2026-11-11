import {subscriptionRuntime} from "../_shared/subscriptionRuntime.ts";
export default {fetch:(req:Request)=>subscriptionRuntime().maintenance(req)};
