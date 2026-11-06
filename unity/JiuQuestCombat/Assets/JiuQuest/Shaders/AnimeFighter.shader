Shader "JiuQuest/Anime Fighter"
{
    Properties
    {
        // Keep the glTFast names and gamma-space factor convention so imported
        // textures, cosmetic recoloring and texture transforms share one contract.
        baseColorFactor ("Base color factor (sRGB)", Vector) = (1,1,1,1)
        baseColorTexture ("Base color", 2D) = "white" {}
        [HideInInspector] baseColorTexture_ST ("Base color transform", Vector) = (1,1,0,0)
        [HideInInspector] baseColorTexture_Rotation ("Base color rotation", Vector) = (0,0,0,0)
        [HideInInspector] baseColorTexture_texCoord ("Base color UV channel", Float) = 0
        alphaCutoff ("Alpha cutoff", Range(0,1)) = 0.5
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 2
        _DetailStrength ("Texture detail", Range(0,1)) = 1
        _DetailBaseColor ("Texture reference (sRGB)", Vector) = (1,1,1,1)
        _InkStrength ("Silhouette ink", Range(0,1)) = 0.52
        _SpecularStrength ("Surface highlight", Range(0,1)) = 0.025
        _RimStrength ("Soft edge light", Range(0,1)) = 0.08
        _NormalDetailStrength ("Surface relief", Range(0,1)) = 0.42
        [HideInInspector] _SurfaceMaps ("Authored normal, roughness, occlusion", Vector) = (0,0,0,0)
        // Imported maps and transforms retain their glTF meaning; the art style
        // changes their lighting response, not their source data.
        [HideInInspector] metallicFactor ("Source metallic", Float) = 0
        [HideInInspector] roughnessFactor ("Source roughness", Float) = 1
        [HideInInspector] metallicRoughnessTexture ("Source metallic roughness", 2D) = "white" {}
        [HideInInspector] metallicRoughnessTexture_ST ("Source MR transform", Vector) = (1,1,0,0)
        [HideInInspector] metallicRoughnessTexture_Rotation ("Source MR rotation", Vector) = (0,0,0,0)
        [HideInInspector] metallicRoughnessTexture_texCoord ("Source MR UV", Float) = 0
        [HideInInspector] normalTexture ("Source normal", 2D) = "bump" {}
        [HideInInspector] normalTexture_ST ("Source normal transform", Vector) = (1,1,0,0)
        [HideInInspector] normalTexture_Rotation ("Source normal rotation", Vector) = (0,0,0,0)
        [HideInInspector] normalTexture_texCoord ("Source normal UV", Float) = 0
        [HideInInspector] normalTexture_scale ("Source normal scale", Float) = 1
        [HideInInspector] occlusionTexture ("Source occlusion", 2D) = "white" {}
        [HideInInspector] occlusionTexture_ST ("Source AO transform", Vector) = (1,1,0,0)
        [HideInInspector] occlusionTexture_Rotation ("Source AO rotation", Vector) = (0,0,0,0)
        [HideInInspector] occlusionTexture_texCoord ("Source AO UV", Float) = 0
        [HideInInspector] occlusionTexture_strength ("Source AO strength", Float) = 1
        [HideInInspector] emissiveFactor ("Source emission", Vector) = (0,0,0,0)
        [HideInInspector] emissiveTexture ("Source emission texture", 2D) = "white" {}
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"

        TEXTURE2D(baseColorTexture);
        SAMPLER(sampler_baseColorTexture);
        TEXTURE2D(normalTexture);
        SAMPLER(sampler_normalTexture);
        TEXTURE2D(metallicRoughnessTexture);
        SAMPLER(sampler_metallicRoughnessTexture);
        TEXTURE2D(occlusionTexture);
        SAMPLER(sampler_occlusionTexture);
        CBUFFER_START(UnityPerMaterial)
            float4 baseColorFactor;
            float4 baseColorTexture_ST;
            float4 baseColorTexture_Rotation;
            float4 _DetailBaseColor;
            float4 _SurfaceMaps;
            float4 normalTexture_ST;
            float4 normalTexture_Rotation;
            float4 metallicRoughnessTexture_ST;
            float4 metallicRoughnessTexture_Rotation;
            float4 occlusionTexture_ST;
            float4 occlusionTexture_Rotation;
            float baseColorTexture_texCoord;
            float normalTexture_texCoord;
            float normalTexture_scale;
            float metallicRoughnessTexture_texCoord;
            float occlusionTexture_texCoord;
            float occlusionTexture_strength;
            float roughnessFactor;
            float metallicFactor;
            float alphaCutoff;
            float _DetailStrength;
            float _InkStrength;
            float _SpecularStrength;
            float _RimStrength;
            float _NormalDetailStrength;
        CBUFFER_END

        float2 SurfaceUV(float2 uv0, float2 uv1, float channel, float4 scaleOffset, float4 rotation)
        {
            float2 uv = lerp(uv0, uv1, step(0.5, channel));
            // glTFast stores the off-diagonal terms in (yx, xy) order.
            return uv * scaleOffset.xy + uv.yx * rotation.yx + scaleOffset.zw;
        }

        float2 FighterUV(float2 uv0, float2 uv1)
        {
            return SurfaceUV(uv0, uv1, baseColorTexture_texCoord, baseColorTexture_ST, baseColorTexture_Rotation);
        }

        half4 FighterTexture(float2 uv)
        {
            half4 texel = SAMPLE_TEXTURE2D(baseColorTexture, sampler_baseColorTexture, uv);
            #if defined(_ALPHATEST_ON)
                clip(texel.a * baseColorFactor.a - alphaCutoff);
            #endif
            return texel;
        }
        ENDHLSL

        Pass
        {
            Name "AnimeForward"
            Tags { "LightMode"="UniversalForward" }
            Cull [_Cull]
            ZWrite On
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FighterVertex
            #pragma fragment FighterFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv0 : TEXCOORD0;
                float2 uv1 : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fog : TEXCOORD3;
                float4 surfaceUVs : TEXCOORD4;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };
            Varyings FighterVertex(Attributes input)
            {
                Varyings output = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = FighterUV(input.uv0, input.uv1);
                output.surfaceUVs = float4(input.uv0, input.uv1);
                output.fog = ComputeFogFactor(position.positionCS.z);
                return output;
            }

            half3 FighterNormal(Varyings input, half3 geometricNormal)
            {
                if (_SurfaceMaps.x < .5) return geometricNormal;
                float2 uv = SurfaceUV(input.surfaceUVs.xy, input.surfaceUVs.zw,
                    normalTexture_texCoord, normalTexture_ST, normalTexture_Rotation);
                // Runtime glTF normal maps are RGB tangent-space data. The
                // derivative frame respects UV1, mirrored islands and rotation
                // without relying on tangents authored for a different UV set.
                half3 normalTS = SAMPLE_TEXTURE2D(normalTexture, sampler_normalTexture, uv).xyz * 2.0h - 1.0h;
                normalTS.xy *= normalTexture_scale * _NormalDetailStrength;
                normalTS.z = max(.05h, normalTS.z);
                float3 dp1 = ddx(input.positionWS), dp2 = ddy(input.positionWS);
                float2 duv1 = ddx(uv), duv2 = ddy(uv);
                float3 dp2perp = cross(dp2, geometricNormal);
                float3 dp1perp = cross(geometricNormal, dp1);
                float3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
                float3 bitangent = dp2perp * duv1.y + dp1perp * duv2.y;
                float lengthSquared = max(dot(tangent, tangent), dot(bitangent, bitangent));
                if (lengthSquared < 1e-12) return geometricNormal;
                float inverseLength = rsqrt(lengthSquared);
                return normalize((tangent * normalTS.x + bitangent * normalTS.y) * inverseLength
                    + geometricNormal * normalTS.z);
            }

            half4 FighterFragment(Varyings input, FRONT_FACE_TYPE facing : FRONT_FACE_SEMANTIC) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                half4 texel = FighterTexture(input.uv);
                half3 albedo = lerp(SRGBToLinear(_DetailBaseColor.rgb), texel.rgb, _DetailStrength)
                    * SRGBToLinear(baseColorFactor.rgb);
                half3 geometricNormal = normalize(input.normalWS) * IS_FRONT_VFACE(facing, 1.0h, -1.0h);
                half3 normalWS = FighterNormal(input, geometricNormal);
                half3 viewWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
                half roughness = roughnessFactor;
                half metallic = metallicFactor;
                if (_SurfaceMaps.y > .5)
                {
                    float2 uv = SurfaceUV(input.surfaceUVs.xy, input.surfaceUVs.zw,
                        metallicRoughnessTexture_texCoord, metallicRoughnessTexture_ST, metallicRoughnessTexture_Rotation);
                    half4 surface = SAMPLE_TEXTURE2D(metallicRoughnessTexture, sampler_metallicRoughnessTexture, uv);
                    roughness *= surface.g;
                    metallic *= surface.b;
                }
                roughness = clamp(roughness, .12h, 1.0h);
                half occlusion = 1;
                if (_SurfaceMaps.z > .5)
                {
                    float2 uv = SurfaceUV(input.surfaceUVs.xy, input.surfaceUVs.zw,
                        occlusionTexture_texCoord, occlusionTexture_ST, occlusionTexture_Rotation);
                    occlusion = lerp(1.0h, SAMPLE_TEXTURE2D(occlusionTexture, sampler_occlusionTexture, uv).r,
                        saturate(occlusionTexture_strength));
                }
                float4 shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                    shadowCoord = ComputeScreenPos(TransformWorldToHClip(input.positionWS));
                #endif
                Light key = GetMainLight(shadowCoord);
                half diffuse = saturate(dot(normalWS, key.direction) * .82h + .18h);
                // Broad illustrated planes blend into a continuous response,
                // keeping folds shaped instead of the previous flat white bands.
                half middle = smoothstep(.10h, .43h, diffuse);
                half bright = smoothstep(.48h, .90h, diffuse);
                half tone = lerp(.32h + .38h * middle + .30h * bright, .27h + .73h * diffuse, .45h);
                half visibility = lerp(.42h, 1.0h, key.shadowAttenuation);
                half3 sky = max(SampleSH(geometricNormal), 0.0h);
                half3 environment = lerp(half3(.13h,.17h,.23h), min(sky, .65h), .42h);
                half3 color = albedo * (environment * occlusion
                    + tone * visibility * key.color * .68h);

                // Separate material responses make cotton matte, hair satin and
                // eyes glossy. A restrained highlight never washes out kit colors.
                half3 halfDirection = SafeNormalize(key.direction + viewWS);
                half highlight = pow(saturate(dot(normalWS, halfDirection)), lerp(110.0h, 7.0h, roughness));
                highlight *= _SpecularStrength * key.shadowAttenuation * saturate(dot(normalWS, key.direction));
                half3 highlightColor = lerp(half3(.85h,.90h,1.0h), albedo, saturate(metallic));
                color += highlightColor * key.color * highlight;

                half viewDot = saturate(dot(geometricNormal, viewWS));
                half edgeLight = pow(1.0h - viewDot, 3.5h) * _RimStrength;
                edgeLight *= .35h + .65h * saturate(dot(geometricNormal, -key.direction));
                color += half3(.43h,.64h,.83h) * edgeLight * occlusion;
                half ink = (1.0h-smoothstep(.025h,.14h,viewDot)) * _InkStrength;
                color *= 1.0h-ink;
                return half4(MixFog(color, input.fog), 1);
            }
            ENDHLSL
        }
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull [_Cull]
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FighterShadowVertex
            #pragma fragment FighterShadowFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection;
            float3 _LightPosition;
            struct ShadowAttributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv0 : TEXCOORD0;
                float2 uv1 : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct ShadowVaryings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            ShadowVaryings FighterShadowVertex(ShadowAttributes input)
            {
                ShadowVaryings output = (ShadowVaryings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                #if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
                    float3 lightDirection = normalize(_LightPosition-positionWS);
                #else
                    float3 lightDirection = _LightDirection;
                #endif
                output.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirection)));
                output.uv = FighterUV(input.uv0, input.uv1);
                return output;
            }
            half4 FighterShadowFragment(ShadowVaryings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                FighterTexture(input.uv);
                return 0;
            }
            ENDHLSL
        }
    }
    Fallback Off
}
